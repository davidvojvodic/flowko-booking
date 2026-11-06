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
 * Flowko U22: the mail server refused the message. Only the transport's rejection is wrapped, so a caller can tell it
 * from an error before sending. The message names no recipient; the original error is kept as `cause`.
 */
export class MailTransportError extends Error {
  constructor(cause: unknown) {
    super("The mail transport did not accept the message", { cause });
    this.name = "MailTransportError";
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

  // Flowko U22: rejects with a MailTransportError when the mail server refuses, so the caller can retry.
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
