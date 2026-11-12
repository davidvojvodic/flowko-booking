import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BaseEmail, { MailTransportError } from "./_base-email";
// Flowko U29d: the invite mail's outcomes
import FlowkoInviteEmail from "./flowko-invite-email";

const { sentPayloads, sendMailError, killSwitch } = vi.hoisted(() => ({
  sentPayloads: [] as Record<string, unknown>[],
  sendMailError: { current: null as Error | null },
  // Flowko U22: the kill switch is switchable per test
  killSwitch: { current: false },
}));

vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally() {
      return Promise.resolve(killSwitch.current);
    }
  },
}));

// Flowko U25: deliver asks which recipients belong to Cal-locked users; none unless a test says otherwise.
const lockedLookup = vi.hoisted(() => ({ addresses: vi.fn() }));
vi.mock("@calcom/features/flowkoBusiness/lockedRecipients", () => ({
  lockedRecipientAddresses: lockedLookup.addresses,
}));
beforeEach(() => {
  lockedLookup.addresses.mockReset();
  lockedLookup.addresses.mockResolvedValue(new Set<string>());
});

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

  // Flowko U25: a desk-only worker's placeholder address (@flowko.invalid) is a faux recipient too
  it("sends the customer only when a desk-only placeholder is in cc", async () => {
    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "Stranka <stranka@example.si>",
      cc: "desk-1@flowko.invalid",
      subject: "Rezervacija potrjena",
    }).sendEmail();

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({ to: [{ name: "Stranka", address: "stranka@example.si" }], cc: [] });
    expect(JSON.stringify(sentPayloads[0])).not.toContain("flowko.invalid");
  });

  it("skips an email whose only recipient is a desk-only placeholder", async () => {
    const result = await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "Desk <desk-1@flowko.invalid>",
      subject: "Nova rezervacija",
    }).sendEmailOrThrow();

    expect(result).toBe("skipped_faux");
    expect(sentPayloads).toHaveLength(0);
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

  it("drops faux emails from cc, bcc and replyTo", async () => {
    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "organizer@flowko.si",
      cc: "Janez Novak <38640123456@sms.cal.com>",
      bcc: "38640999888@sms.cal.com,member@flowko.si",
      // Organizer emails reply to the attendees, a phone-only booker among them
      replyTo: "38640123456@sms.cal.com, guest@example.si",
      subject: "Nova rezervacija",
    }).sendEmail();

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({
      to: [{ name: "", address: "organizer@flowko.si" }],
      cc: [],
      bcc: [{ name: "", address: "member@flowko.si" }],
      replyTo: [{ name: "", address: "guest@example.si" }],
    });
    expect(JSON.stringify(sentPayloads[0])).not.toContain("sms.cal.com");
  });

  it("leaves replyTo empty when it only held faux emails", async () => {
    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "organizer@flowko.si",
      replyTo: "38640123456@sms.cal.com",
      subject: "Nova rezervacija",
    }).sendEmail();

    expect(sentPayloads).toHaveLength(1);
    // nodemailer writes no Reply-To header for an empty list
    expect(sentPayloads[0]).toMatchObject({ replyTo: [] });
    expect(JSON.stringify(sentPayloads[0])).not.toContain("38640123456");
  });

  it("sends to the cc recipients when every to address is faux", async () => {
    await new TestEmail({
      from: "Organizer <noreply@flowko.si>",
      to: "Janez Novak <38640123456@sms.cal.com>",
      cc: "cc@flowko.si",
      subject: "Rezervacija potrjena",
    }).sendEmail();

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({ to: [], cc: [{ name: "", address: "cc@flowko.si" }] });
    expect(JSON.stringify(sentPayloads[0])).not.toContain("38640123456");
  });

  it("sends nothing when to, cc and bcc hold only faux emails", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new TestEmail({
      from: "Organizer <noreply@flowko.si>",
      to: "Janez Novak <38640123456@sms.cal.com>",
      cc: "38640999888@sms.cal.com",
      bcc: "Gost <38640777666@sms.cal.com>",
      replyTo: "organizer@flowko.si",
      subject: "Rezervacija potrjena",
    }).sendEmail();
    const logged = JSON.stringify([consoleLogSpy.mock.calls, result]);
    consoleLogSpy.mockRestore();

    expect(sentPayloads).toHaveLength(0);
    expect(logged).not.toMatch(/386\d+/);
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

// Flowko U22: the reminder sweep needs a send that rejects when the mail server refuses, so it can retry;
// every existing caller keeps the send that never rejects on a refusal.
describe("BaseEmail.sendEmailOrThrow", () => {
  const rejectedRecipientError = (): Error =>
    Object.assign(
      new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <booker@example.si>: no user"),
      {
        code: "EENVELOPE",
        responseCode: 550,
        command: "RCPT TO",
        response: "550 5.1.1 <booker@example.si>: unknown user",
        rejected: ["booker@example.si"],
      }
    );
  const payload = {
    from: "Organizer <noreply@flowko.si>",
    to: "Janez Novak <booker@example.si>",
    subject: "Opomnik: Janez Novak",
  };

  beforeEach(() => {
    sentPayloads.length = 0;
    sendMailError.current = null;
    killSwitch.current = false;
    vi.stubEnv("INTEGRATION_TEST_MODE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves to sent when the mail server accepts", async () => {
    await expect(new TestEmail(payload).sendEmailOrThrow()).resolves.toBe("sent");
    expect(sentPayloads).toHaveLength(1);
  });

  it("rejects when the mail server refuses, and logs no address or name", async () => {
    sendMailError.current = rejectedRecipientError();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const error = await new TestEmail(payload).sendEmailOrThrow().then(
      () => null,
      (e: unknown) => e
    );
    const logged = JSON.stringify(consoleErrorSpy.mock.calls);

    expect(error).toBeInstanceOf(MailTransportError);
    expect((error as Error).message).not.toContain("booker@example.si");
    expect(logged).toContain("EENVELOPE");
    expect(logged).toContain("550");
    expect(logged).not.toContain("booker@example.si");
    expect(logged).not.toContain("Janez Novak");
  });

  it("sendEmail still resolves on the same refusal", async () => {
    sendMailError.current = rejectedRecipientError();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(new TestEmail(payload).sendEmail()).resolves.toBe("send mail async");
  });

  it("sendEmail still rejects when the payload cannot be built", async () => {
    class BrokenEmail extends BaseEmail {
      protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
        throw new Error("payload build failed");
      }
    }

    await expect(new BrokenEmail().sendEmail()).rejects.toThrow("payload build failed");
    await expect(new BrokenEmail().sendEmail()).rejects.not.toBeInstanceOf(MailTransportError);
    expect(sentPayloads).toHaveLength(0);
  });

  it("sendEmailOrThrow rejects when the payload cannot be built", async () => {
    class BrokenEmail extends BaseEmail {
      protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
        throw new Error("payload build failed");
      }
    }

    await expect(new BrokenEmail().sendEmailOrThrow()).rejects.toThrow("payload build failed");
  });

  it("resolves to skipped_kill_switch when the kill switch is on, and sends nothing", async () => {
    killSwitch.current = true;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(new TestEmail(payload).sendEmailOrThrow()).resolves.toBe("skipped_kill_switch");
    await expect(new TestEmail(payload).sendEmail()).resolves.toBe(
      "Skipped Sending Email due to active Kill Switch"
    );
    expect(sentPayloads).toHaveLength(0);
  });

  it("resolves to skipped_faux for a phone-only booker, and sends nothing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      new TestEmail({ ...payload, to: "Janez Novak <38640123456@sms.cal.com>" }).sendEmailOrThrow()
    ).resolves.toBe("skipped_faux");
    expect(sentPayloads).toHaveLength(0);
  });

  it("resolves to skipped_test_mode in integration test mode", async () => {
    vi.stubEnv("INTEGRATION_TEST_MODE", "true");
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(new TestEmail(payload).sendEmailOrThrow()).resolves.toBe("skipped_test_mode");
    expect(sentPayloads).toHaveLength(0);
  });
});

// Flowko U25 (D1, P6, Review Focus 4): no booking mail reaches a locked worker; the customer still gets theirs.
// A failed lookup sends nothing (Ruling 12: fail closed) and is not a transport error, so U22 releases its claim.
describe("BaseEmail: recipients who are locked users", () => {
  beforeEach(() => {
    sentPayloads.length = 0;
    sendMailError.current = null;
    killSwitch.current = false;
    vi.stubEnv("INTEGRATION_TEST_MODE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends to the customer only when a locked worker is in cc", async () => {
    lockedLookup.addresses.mockResolvedValue(new Set(["ana@example.com"]));

    await expect(
      new TestEmail({
        from: "Flowko <noreply@flowko.si>",
        to: "Stranka <stranka@example.com>",
        cc: "Ana <Ana@Example.com>",
        subject: "Rezervacija potrjena",
      }).sendEmailOrThrow()
    ).resolves.toBe("sent");

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({
      to: [{ name: "Stranka", address: "stranka@example.com" }],
      cc: [],
    });
    expect(JSON.stringify(sentPayloads[0]).toLowerCase()).not.toContain("ana@example.com");
    expect(lockedLookup.addresses).toHaveBeenCalledWith(["stranka@example.com", "Ana@Example.com"]);
  });

  it("drops a locked user's address from to and bcc as well", async () => {
    lockedLookup.addresses.mockResolvedValue(new Set(["ana.alt@example.com", "ana@example.com"]));

    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "ana.alt@example.com, stranka@example.com",
      bcc: "ANA@example.com, owner@example.com",
      subject: "Nova rezervacija",
    }).sendEmail();

    expect(sentPayloads[0]).toMatchObject({
      to: [{ name: "", address: "stranka@example.com" }],
      bcc: [{ name: "", address: "owner@example.com" }],
    });
  });

  it("resolves to skipped_locked when the only recipient is a locked worker, and sends nothing", async () => {
    lockedLookup.addresses.mockResolvedValue(new Set(["ana@example.com"]));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      new TestEmail({
        from: "Flowko <noreply@flowko.si>",
        to: "Ana <ana@example.com>",
        subject: "Opomnik",
      }).sendEmailOrThrow()
    ).resolves.toBe("skipped_locked");
    expect(sentPayloads).toHaveLength(0);
  });

  it("sendEmail answers skipped_locked with a legacy string of its own", async () => {
    lockedLookup.addresses.mockResolvedValue(new Set(["ana@example.com"]));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "ana@example.com",
      subject: "Opomnik",
    }).sendEmail();

    expect(typeof result).toBe("string");
    expect(result).toBe("Skipped Sending Email to locked user");
    expect(sentPayloads).toHaveLength(0);
  });

  it("a failed lookup sends nothing and rejects with a non-transport error (both sends)", async () => {
    const lookupError = new Error("lookup failed");
    lockedLookup.addresses.mockRejectedValue(lookupError);
    const payload = { from: "Flowko <noreply@flowko.si>", to: "stranka@example.com", subject: "Opomnik" };

    const thrown = await new TestEmail(payload).sendEmailOrThrow().then(
      () => null,
      (e: unknown) => e
    );
    expect(thrown).toBe(lookupError);
    expect(thrown).not.toBeInstanceOf(MailTransportError);
    await expect(new TestEmail(payload).sendEmail()).rejects.toBe(lookupError);
    expect(sentPayloads).toHaveLength(0);
  });

  it("asks nothing when every recipient was faux, in test mode, or with the kill switch on", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "desk-1@flowko.invalid",
    }).sendEmailOrThrow();
    killSwitch.current = true;
    await new TestEmail({ from: "Flowko <noreply@flowko.si>", to: "stranka@example.com" }).sendEmailOrThrow();
    killSwitch.current = false;
    vi.stubEnv("INTEGRATION_TEST_MODE", "true");
    await new TestEmail({ from: "Flowko <noreply@flowko.si>", to: "stranka@example.com" }).sendEmailOrThrow();

    expect(lockedLookup.addresses).not.toHaveBeenCalled();
  });

  it("checks only the real addresses, not faux ones or replyTo", async () => {
    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "38640123456@sms.cal.com, stranka@example.com",
      cc: "desk-1@flowko.invalid",
      replyTo: "ana@example.com",
      subject: "Nova rezervacija",
    }).sendEmail();

    expect(lockedLookup.addresses).toHaveBeenCalledWith(["stranka@example.com"]);
  });
});

// Flowko U22: the sweep releases its claim only when the server cannot have taken the message.
describe("MailTransportError.definitelyNotSent", () => {
  /** Shaped like nodemailer's SMTPConnection._formatError output (command/code/responseCode). */
  const smtpError = (fields: { code?: string; responseCode?: number; command?: string }): Error =>
    Object.assign(new Error("smtp failure for booker@example.si"), fields);

  const rejectedBy = async (error: Error): Promise<MailTransportError> => {
    sendMailError.current = error;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rejection = await new TestEmail({
      from: "Organizer <noreply@flowko.si>",
      to: "Janez Novak <booker@example.si>",
      subject: "Opomnik",
    })
      .sendEmailOrThrow()
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(rejection).toBeInstanceOf(MailTransportError);
    return rejection as MailTransportError;
  };

  beforeEach(() => {
    sentPayloads.length = 0;
    sendMailError.current = null;
    killSwitch.current = false;
    vi.stubEnv("INTEGRATION_TEST_MODE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["a 550 refusal of the message", { code: "EMESSAGE", responseCode: 550, command: "DATA" }],
    ["a 5xx refusal of every recipient", { code: "EENVELOPE", responseCode: 550, command: "RCPT TO" }],
    ["a 4xx deferral of the sender", { code: "EENVELOPE", responseCode: 451, command: "MAIL FROM" }],
    ["a failed login", { code: "EAUTH", command: "AUTH PLAIN" }],
    ["a failed STARTTLS upgrade", { code: "ETLS", command: "STARTTLS" }],
    ["a DNS failure while connecting", { code: "EDNS", command: "CONN" }],
  ])("is true for %s", async (_label, fields) => {
    expect((await rejectedBy(smtpError(fields))).definitelyNotSent).toBe(true);
  });

  it.each([
    ["a timeout during DATA, no server answer", { code: "ETIMEDOUT", command: "DATA" }],
    // nodemailer tags a socket timeout, socket error or unexpected close as CONN at any stage, after DATA too
    ["a socket timeout (CONN, any stage)", { code: "ETIMEDOUT", command: "CONN" }],
    ["a connection reset (ESOCKET, CONN)", { code: "ESOCKET", command: "CONN" }],
    ["an unexpected close (ECONNECTION, CONN)", { code: "ECONNECTION", command: "CONN" }],
    ["an error with no command", { code: "ECONNRESET" }],
  ])("is false for %s", async (_label, fields) => {
    expect((await rejectedBy(smtpError(fields))).definitelyNotSent).toBe(false);
  });

  /**
   * As nodemailer 7 builds them (smtp-connection/index.js): a socket error keeps Node's own error object with `code`
   * overwritten to ESOCKET (`_formatError`) and Node's `syscall` intact; a timer failure is `new Error(<fixed text>)`.
   */
  const nodemailerError = (
    message: string,
    fields: { code: string; command: string; syscall?: string; errno?: number }
  ): Error => Object.assign(new Error(message), fields);

  it.each([
    [
      "a refused connection (socket error at connect)",
      nodemailerError("connect ECONNREFUSED 10.0.0.1:587", {
        code: "ESOCKET",
        command: "CONN",
        syscall: "connect",
        errno: -61,
      }),
    ],
    [
      "an unreachable host",
      nodemailerError("connect EHOSTUNREACH 10.0.0.1:587", {
        code: "ESOCKET",
        command: "CONN",
        syscall: "connect",
        errno: -65,
      }),
    ],
    [
      "an unreachable network",
      nodemailerError("connect ENETUNREACH 10.0.0.1:587", {
        code: "ESOCKET",
        command: "CONN",
        syscall: "connect",
        errno: -51,
      }),
    ],
    ["the connection timeout", nodemailerError("Connection timeout", { code: "ETIMEDOUT", command: "CONN" })],
    ["no greeting", nodemailerError("Greeting never received", { code: "ETIMEDOUT", command: "CONN" })],
  ])("is true for a connect-stage failure: %s", async (_label, error) => {
    expect((await rejectedBy(error)).definitelyNotSent).toBe(true);
  });

  it.each([
    ["a socket timeout mid-DATA", nodemailerError("Timeout", { code: "ETIMEDOUT", command: "CONN" })],
    [
      "a connection reset mid-DATA",
      nodemailerError("read ECONNRESET", { code: "ESOCKET", command: "CONN", syscall: "read", errno: -54 }),
    ],
    [
      "a broken pipe mid-DATA",
      nodemailerError("write EPIPE", { code: "ESOCKET", command: "CONN", syscall: "write", errno: -32 }),
    ],
  ])("is false for a mid-session failure: %s", async (_label, error) => {
    expect((await rejectedBy(error)).definitelyNotSent).toBe(false);
  });

  it("matches the installed nodemailer's connect-stage markers (re-check on upgrade)", () => {
    const source = readFileSync(
      createRequire(import.meta.url).resolve("nodemailer/lib/smtp-connection/index.js"),
      "utf8"
    );
    expect(source).toContain("this._onError(error, 'ESOCKET', false, 'CONN')");
    expect(source).toContain("this._onError('Connection timeout', 'ETIMEDOUT', false, 'CONN')");
    expect(source).toContain("this._onError('Greeting never received', 'ETIMEDOUT', false, 'CONN')");
    expect(source).toContain("this._onError(new Error('Timeout'), 'ETIMEDOUT', false, 'CONN')");
    expect(source).toMatch(/_onConnect\(\) \{\s+clearTimeout\(this\._connectionTimeout\);/);
  });

  it("logs no message, syscall or server address for a connect-stage failure", async () => {
    sendMailError.current = nodemailerError("connect ECONNREFUSED 10.0.0.1:587", {
      code: "ESOCKET",
      command: "CONN",
      syscall: "connect",
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await new TestEmail({ to: "booker@example.si", subject: "x" }).sendEmailOrThrow().catch(() => undefined);
    const logged = JSON.stringify(consoleErrorSpy.mock.calls);
    consoleErrorSpy.mockRestore();

    expect(logged).toContain("ESOCKET");
    expect(logged).not.toContain("10.0.0.1");
    expect(logged).not.toContain("connect");
    expect(logged).not.toContain("ECONNREFUSED");
  });

  it("sendEmail resolves and logs the same codes whatever the flag", async () => {
    for (const fields of [
      { code: "EENVELOPE", responseCode: 550, command: "RCPT TO" },
      { code: "ETIMEDOUT", command: "DATA" },
    ]) {
      sendMailError.current = smtpError(fields);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await expect(new TestEmail({ to: "booker@example.si", subject: "x" }).sendEmail()).resolves.toBe(
        "send mail async"
      );
      const logged = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(logged).toContain(fields.code);
      expect(logged).not.toContain("definitelyNotSent");
      expect(logged).not.toContain("booker@example.si");
      consoleErrorSpy.mockRestore();
    }
  });
});

// Flowko U29d Task 6 (E2): the invite mail reports what really happened, through the real template. The service
// (Task 2) maps all three results below to `mail: "not_sent"`; only "sent" counts as sent.
describe("FlowkoInviteEmail outcomes", () => {
  const args = {
    to: "ana@example.si",
    name: "Ana",
    businessName: "Frizerstvo & Co",
    replyTo: "info@frizerstvo-co.si",
    link: "https://booking.example.com/auth/pridruzi/TOKEN",
    expiresDate: "pon., 23. 11. 2026",
    expiresTime: "08:07",
  };

  beforeEach(() => {
    sentPayloads.length = 0;
    sendMailError.current = null;
    killSwitch.current = false;
    vi.stubEnv("INTEGRATION_TEST_MODE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves to sent when the mail server accepts, with Reply-To and the raw business name", async () => {
    await expect(new FlowkoInviteEmail(args).sendEmailOrThrow()).resolves.toBe("sent");
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({
      to: [{ name: "", address: "ana@example.si" }],
      replyTo: [{ name: "", address: "info@frizerstvo-co.si" }],
    });
    expect((sentPayloads[0].from as { name: string }).name).toBe("Frizerstvo & Co");
  });

  it("resolves to skipped_kill_switch and sends nothing when the kill switch is on", async () => {
    killSwitch.current = true;

    await expect(new FlowkoInviteEmail(args).sendEmailOrThrow()).resolves.toBe("skipped_kill_switch");
    expect(sentPayloads).toHaveLength(0);
  });

  it("resolves to skipped_locked and sends nothing when the recipient belongs to a locked user", async () => {
    lockedLookup.addresses.mockResolvedValue(new Set(["ana@example.si"]));

    await expect(new FlowkoInviteEmail(args).sendEmailOrThrow()).resolves.toBe("skipped_locked");
    expect(sentPayloads).toHaveLength(0);
  });

  it("rethrows a MailTransportError that names neither the address nor the token", async () => {
    sendMailError.current = Object.assign(
      new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <ana@example.si>: no user"),
      { code: "EENVELOPE", responseCode: 550, command: "RCPT TO", rejected: ["ana@example.si"] }
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const error = await new FlowkoInviteEmail(args).sendEmailOrThrow().then(
      () => null,
      (e: unknown) => e
    );
    const logged = JSON.stringify(consoleErrorSpy.mock.calls);

    expect(error).toBeInstanceOf(MailTransportError);
    expect((error as MailTransportError).message).not.toContain("ana@example.si");
    expect(logged).not.toContain("ana@example.si");
    expect(logged).not.toContain("TOKEN");
  });
});
