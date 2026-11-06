import { decodeHTML } from "entities";
import { z } from "zod";

import dayjs from "@calcom/dayjs";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import isSmsCalEmail from "@calcom/lib/isSmsCalEmail";
import { serverConfig } from "@calcom/lib/serverConfig";
import { getServerErrorFromUnknown } from "@calcom/lib/server/getServerErrorFromUnknown";
import { setTestEmail } from "@calcom/lib/testEmails";
import { prisma } from "@calcom/prisma";

import { type MailAddress, toMailAddresses } from "../lib/sanitizeDisplayName";
import { formatRecipientDate } from "../lib/utils/date-formatting";

/**
 * Nodemailer errors can quote recipient addresses: in the message and response of a rejected
 * recipient, and in `rejected`/`envelope`. Keep only the codes; getServerErrorFromUnknown wraps the
 * nodemailer error as `cause`.
 */
const getLoggableMailError = (error: unknown) => {
  const { name, statusCode, cause } = (error ?? {}) as {
    name?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };
  const { code, responseCode, command } = (cause ?? error ?? {}) as {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
  };
  return { name, statusCode, code, responseCode, command };
};

// Flowko U22: nodemailer's SMTP stages (SMTPConnection `command`) that fail before the body is handed over.
const PRE_BODY_COMMANDS: ReadonlySet<string> = new Set([
  "EHLO",
  "HELO",
  "LHLO",
  "STARTTLS",
  "MAIL FROM",
  "RCPT TO",
]);
// Flowko U22: nodemailer also tags a socket error, socket timeout or unexpected close as "CONN" at any stage,
// after DATA too, so "CONN" counts only with a code raised before the message body is handed over (the
// connect or TLS stage: DNS, TLS initiation or a STARTTLS upgrade).
const CONNECT_ONLY_CODES: ReadonlySet<string> = new Set(["EDNS", "ETLS"]);
// Flowko U22: nodemailer 7's fixed texts for its two pre-greeting timers (smtp-connection/index.js: the
// connection timer is cleared in _onConnect, the greeting timer fires only while the greeting is awaited). A
// session socket timeout is "Timeout", so it is not in here.
const PRE_GREETING_TIMEOUTS: ReadonlySet<string> = new Set(["Connection timeout", "Greeting never received"]);

/**
 * Flowko U22: a "CONN" failure proven to be before the message body is handed over (the connect or TLS
 * stage): a DNS or TLS code, a socket error from the connect syscall (refused, host or network unreachable;
 * nodemailer overwrites `code` with ESOCKET but keeps Node's `syscall`), or a pre-greeting timer. Reads
 * `syscall` and `message` here only, never logs them.
 */
const isConnectStageFailure = (cause: unknown, code: unknown): boolean => {
  if (typeof code !== "string") return false;
  if (CONNECT_ONLY_CODES.has(code)) return true;
  const { cause: inner } = (cause ?? {}) as { cause?: unknown };
  const { syscall, message } = (inner ?? cause ?? {}) as { syscall?: unknown; message?: unknown };
  if (code === "ESOCKET") return syscall === "connect";
  return code === "ETIMEDOUT" && typeof message === "string" && PRE_GREETING_TIMEOUTS.has(message);
};

/**
 * Flowko U22: true when the server cannot have taken the message: it answered with an SMTP 4xx/5xx, or the
 * failure came before the body was handed over (connect stage included). A timeout or reset with no answer
 * mid-session (e.g. mid-DATA) is false: the server may already have accepted it. Reads the codes and
 * nodemailer's fixed connect-timer texts; never logs a message or response (they can quote addresses).
 */
const isDefinitelyNotSent = (cause: unknown): boolean => {
  const { code, responseCode, command } = getLoggableMailError(cause);
  if (typeof responseCode === "number" && responseCode >= 400 && responseCode <= 599) return true;
  if (typeof command !== "string") return false;
  if (PRE_BODY_COMMANDS.has(command) || command.startsWith("AUTH")) return true;
  return command === "CONN" && isConnectStageFailure(cause, code);
};

// Flowko U22: the strings sendEmail resolved to before U22, kept for its callers.
const LEGACY_SEND_RESULTS: Record<MailSendOutcome, string> = {
  sent: "send mail async",
  skipped_kill_switch: "Skipped Sending Email due to active Kill Switch",
  skipped_faux: "Skipped Sending Email to faux email",
  skipped_test_mode: "Skipped sendEmail for Unit Tests",
};

// Flowko U22: what a send did. The reminder sweep keeps or releases its claim by it.
export type MailSendOutcome = "sent" | "skipped_kill_switch" | "skipped_faux" | "skipped_test_mode";

/**
 * Flowko U22: the mail transport failed. Only the transport's failure is wrapped, so a caller can tell it
 * from an error before sending. The message names no recipient; the original error is kept as `cause`.
 */
export class MailTransportError extends Error {
  /** Flowko U22: the server cannot have taken the message, so a retry cannot send it twice. */
  readonly definitelyNotSent: boolean;

  constructor(cause: unknown) {
    super("The mail transport did not accept the message", { cause });
    this.name = "MailTransportError";
    this.definitelyNotSent = isDefinitelyNotSent(cause);
  }
}

export default class BaseEmail {
  name = "";

  protected getTimezone() {
    return "";
  }

  protected getLocale(): string {
    return "";
  }

  protected getFormattedRecipientTime({ time, format }: { time: string; format: string }) {
    return dayjs(time).tz(this.getTimezone()).locale(this.getLocale()).format(format);
  }

  protected getFormattedRecipientDate(time: string) {
    return formatRecipientDate({ time, timeZone: this.getTimezone(), locale: this.getLocale() });
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {};
  }
  // Flowko U22: resolves even when the mail server refuses (logged), as before U22; every other error rejects.
  public async sendEmail() {
    try {
      return LEGACY_SEND_RESULTS[await this.deliver()];
    } catch (e) {
      if (!(e instanceof MailTransportError)) throw e;
      // The subject and sender name can hold the booker's and organizer's names
      console.error("sendEmail", this.name, getLoggableMailError(e.cause));
      return LEGACY_SEND_RESULTS.sent;
    }
  }

  // Flowko U22: rejects with a MailTransportError if the transport fails (definitelyNotSent: safe to retry).
  public async sendEmailOrThrow(): Promise<MailSendOutcome> {
    try {
      return await this.deliver();
    } catch (e) {
      if (e instanceof MailTransportError) {
        console.error("sendEmailOrThrow", this.name, getLoggableMailError(e.cause));
      }
      throw e;
    }
  }

  // Flowko U22: the body of sendEmail before U22, the transport's rejection no longer swallowed.
  private async deliver(): Promise<MailSendOutcome> {
    const featuresRepository = new FeaturesRepository(prisma);
    const emailsDisabled = await featuresRepository.checkIfFeatureIsEnabledGlobally("emails");
    /** If email kill switch exists and is active, we prevent emails being sent. */
    if (emailsDisabled) {
      console.warn("Skipped Sending Email due to active Kill Switch");
      return "skipped_kill_switch";
    }

    if (process.env.INTEGRATION_TEST_MODE === "true") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-expect-error
      setTestEmail(await this.getNodeMailerPayload());
      console.log(
        "Skipped Sending Email as process.env.NEXT_PUBLIC_UNIT_TESTS is set. Emails are available in globalThis.testEmails"
      );
      return "skipped_test_mode";
    }

    const payload = await this.getNodeMailerPayload();

    const from = "from" in payload ? (payload.from as string) : "";
    const to = "to" in payload ? (payload.to as string) : "";

    const toAddresses = toMailAddresses(to);
    const parsedOptionalAddressFields = Object.fromEntries(
      (["replyTo", "cc", "bcc"] as const)
        .filter((field) => typeof payload[field] === "string")
        .map((field) => [field, toMailAddresses(payload[field] as string)] as const)
    );

    // A faux email is built from the booker's phone number, so it is never sent or logged. Flowko:
    // attendee templates address `Name <address>`, so the parsed addresses are checked, not the fields.
    // Faux emails are dropped from to, cc, bcc and replyTo. When every recipient was one, nothing is sent.
    const isRealAddress = ({ address }: MailAddress) => !isSmsCalEmail(address);
    const recipients = [
      ...toAddresses,
      ...(parsedOptionalAddressFields.cc ?? []),
      ...(parsedOptionalAddressFields.bcc ?? []),
    ];
    if (recipients.length && !recipients.some(isRealAddress)) {
      console.log(`Skipped Sending Email to faux email for ${this.name}`);
      return "skipped_faux";
    }

    const realToAddresses = toAddresses.filter(isRealAddress);
    const optionalAddressFields = Object.fromEntries(
      Object.entries(parsedOptionalAddressFields).map(
        ([field, addresses]) => [field, addresses.filter(isRealAddress)] as const
      )
    );

    const parseSubject = z.string().safeParse(payload?.subject);
    const payloadWithUnEscapedSubject = {
      headers: this.getMailerOptions().headers,
      ...payload,
      ...{
        from: toMailAddresses(from)[0],
        to: realToAddresses,
        ...optionalAddressFields,
      },
      ...(parseSubject.success && { subject: decodeHTML(parseSubject.data) }),
    };
    const { createTransport } = await import("nodemailer");
    try {
      await new Promise((resolve, reject) =>
        createTransport(this.getMailerOptions().transport).sendMail(
          payloadWithUnEscapedSubject,
          (_err, info) => {
            if (_err) {
              const err = getServerErrorFromUnknown(_err);
              this.printNodeMailerError(err);
              reject(err);
            } else {
              resolve(info);
            }
          }
        )
      );
    } catch (e) {
      // Flowko U22: tagged instead of swallowed here; sendEmail swallows it, sendEmailOrThrow rejects with it
      throw new MailTransportError(e);
    }
    return "sent";
  }
  protected getMailerOptions() {
    return {
      transport: serverConfig.transport,
      from: serverConfig.from,
      headers: serverConfig.headers,
    };
  }
  protected printNodeMailerError(error: Error): void {
    /** Don't clog the logs with unsent emails in E2E */
    if (process.env.NEXT_PUBLIC_IS_E2E) return;
    console.error(`${this.name}_ERROR`, getLoggableMailError(error));
  }
}
