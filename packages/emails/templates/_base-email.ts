import { decodeHTML } from "entities";
import { z } from "zod";

import dayjs from "@calcom/dayjs";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import isSmsCalEmail from "@calcom/lib/isSmsCalEmail";
import { serverConfig } from "@calcom/lib/serverConfig";
import { getServerErrorFromUnknown } from "@calcom/lib/server/getServerErrorFromUnknown";
import { setTestEmail } from "@calcom/lib/testEmails";
import { prisma } from "@calcom/prisma";

import { toMailAddresses } from "../lib/sanitizeDisplayName";
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
  public async sendEmail() {
    const featuresRepository = new FeaturesRepository(prisma);
    const emailsDisabled = await featuresRepository.checkIfFeatureIsEnabledGlobally("emails");
    /** If email kill switch exists and is active, we prevent emails being sent. */
    if (emailsDisabled) {
      console.warn("Skipped Sending Email due to active Kill Switch");
      return new Promise((r) => r("Skipped Sending Email due to active Kill Switch"));
    }

    if (process.env.INTEGRATION_TEST_MODE === "true") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-expect-error
      setTestEmail(await this.getNodeMailerPayload());
      console.log(
        "Skipped Sending Email as process.env.NEXT_PUBLIC_UNIT_TESTS is set. Emails are available in globalThis.testEmails"
      );
      return new Promise((r) => r("Skipped sendEmail for Unit Tests"));
    }

    const payload = await this.getNodeMailerPayload();

    const from = "from" in payload ? (payload.from as string) : "";
    const to = "to" in payload ? (payload.to as string) : "";

    // A faux email is built from the booker's phone number, so it is never sent or logged. Flowko:
    // attendee templates address `Name <address>`, so the parsed addresses are checked, not the field
    const toAddresses = toMailAddresses(to);
    const realToAddresses = toAddresses.filter(({ address }) => !isSmsCalEmail(address));
    if (toAddresses.length && !realToAddresses.length) {
      console.log(`Skipped Sending Email to faux email for ${this.name}`);
      return new Promise((r) => r("Skipped Sending Email to faux email"));
    }

    const optionalAddressFields = Object.fromEntries(
      (["replyTo", "cc", "bcc"] as const)
        .filter((field) => typeof payload[field] === "string")
        .map((field) => [field, toMailAddresses(payload[field] as string)] as const)
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
    ).catch((e) =>
      // The subject and sender name can hold the booker's and organizer's names
      console.error("sendEmail", this.name, getLoggableMailError(e))
    );
    return new Promise((resolve) => resolve("send mail async"));
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
