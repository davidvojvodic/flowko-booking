import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BaseEmail from "./_base-email";

const { sentPayloads, sendMailError } = vi.hoisted(() => ({
  sentPayloads: [] as Record<string, unknown>[],
  sendMailError: { current: null as Error | null },
}));

vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally() {
      return Promise.resolve(false);
    }
  },
}));

vi.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: (payload: Record<string, unknown>, callback: (error: Error | null, info: unknown) => void) => {
      sentPayloads.push(payload);
      callback(sendMailError.current, {});
    },
  }),
}));

class TestEmail extends BaseEmail {
  payload: Record<string, unknown>;

  constructor(payload: Record<string, unknown>) {
    super();
    this.payload = payload;
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return this.payload;
  }
}

describe("BaseEmail.sendEmail address fields", () => {
  beforeEach(() => {
    sentPayloads.length = 0;
    sendMailError.current = null;
    // Vitest sets INTEGRATION_TEST_MODE, which makes sendEmail return before nodemailer is reached.
    vi.stubEnv("INTEGRATION_TEST_MODE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hands nodemailer one recipient for a booker name that holds an address list", async () => {
    await new TestEmail({
      from: "Organizer <noreply@flowko.si>",
      to: "Janez <attacker-target@example.org>, x <booker@example.si>",
      replyTo: "guest@example.si, organizer@flowko.si",
      subject: "Rezervacija potrjena",
    }).sendEmail();

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({
      from: { name: "Organizer", address: "noreply@flowko.si" },
      to: [{ name: "Janez attacker-target@example.org x", address: "booker@example.si" }],
      replyTo: [
        { name: "", address: "guest@example.si" },
        { name: "", address: "organizer@flowko.si" },
      ],
      subject: "Rezervacija potrjena",
    });
  });

  it("sends nothing for a faux phone email that holds an address list", async () => {
    // toMailAddresses reads it as one mailbox at sms.cal.com (see sanitizeDisplayName.test.ts),
    // which is a faux email, so no recipient is left
    await new TestEmail({
      from: "Organizer <noreply@flowko.si>",
      to: "Janez <38640123456;isub=>,attacker-target@example.org,x@sms.cal.com>",
      subject: "Rezervacija potrjena",
    }).sendEmail();

    expect(sentPayloads).toHaveLength(0);
  });

  it("keeps every address of a joined recipient list, cc and bcc included", async () => {
    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "organizer@flowko.si,member@flowko.si",
      cc: "cc@flowko.si",
      bcc: "Janez <attacker-target@example.org>, x <bcc@flowko.si>",
      subject: "Nova rezervacija",
    }).sendEmail();

    expect(sentPayloads[0]).toMatchObject({
      to: [
        { name: "", address: "organizer@flowko.si" },
        { name: "", address: "member@flowko.si" },
      ],
      cc: [{ name: "", address: "cc@flowko.si" }],
      bcc: [{ name: "Janez attacker-target@example.org x", address: "bcc@flowko.si" }],
    });
  });

  it("keeps the booker's address and name out of the log when sending fails", async () => {
    // Like nodemailer's rejected-recipient error, the message and response quote the address
    sendMailError.current = Object.assign(
      new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <booker@example.si>: no user"),
      {
        code: "EENVELOPE",
        responseCode: 550,
        command: "RCPT TO",
        response: "550 5.1.1 <booker@example.si>: unknown user",
        rejected: ["booker@example.si"],
      }
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await new TestEmail({
      from: "Organizer <noreply@flowko.si>",
      to: "Janez Novak <booker@example.si>",
      subject: "Rezervacija potrjena: Janez Novak",
    }).sendEmail();
    const logged = JSON.stringify(consoleErrorSpy.mock.calls);
    consoleErrorSpy.mockRestore();

    expect(logged).toContain("EENVELOPE");
    expect(logged).toContain("550");
    expect(logged).not.toContain("booker@example.si");
    expect(logged).not.toContain("Janez Novak");
  });

  it("does not log the phone number of a faux email it skips", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new TestEmail({
      from: "Organizer <noreply@flowko.si>",
      to: "38640123456@sms.cal.com",
      subject: "Rezervacija potrjena",
    }).sendEmail();
    const logged = JSON.stringify([consoleLogSpy.mock.calls, result]);
    consoleLogSpy.mockRestore();

    expect(sentPayloads).toHaveLength(0);
    expect(logged).not.toContain("38640123456");
  });

  it("skips a named faux email, as attendee templates address it", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new TestEmail({
      from: "Organizer <noreply@flowko.si>",
      to: "Janez Novak <38640123456@sms.cal.com>",
      subject: "Rezervacija potrjena",
    }).sendEmail();
    const logged = JSON.stringify([consoleLogSpy.mock.calls, result]);
    consoleLogSpy.mockRestore();

    expect(sentPayloads).toHaveLength(0);
    expect(logged).not.toContain("38640123456");
  });

  it("drops faux emails from a recipient list and sends to the rest", async () => {
    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "organizer@flowko.si,38640123456@sms.cal.com",
      subject: "Nova rezervacija",
    }).sendEmail();

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({ to: [{ name: "", address: "organizer@flowko.si" }] });
  });

  it("adds no replyTo when the template sets none", async () => {
    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "Janez <booker@example.si>",
      subject: "Rezervacija potrjena",
    }).sendEmail();

    expect(sentPayloads[0]).not.toHaveProperty("replyTo");
  });
});
