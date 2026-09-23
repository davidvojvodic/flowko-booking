import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BaseEmail from "./_base-email";

const { sentPayloads } = vi.hoisted(() => ({ sentPayloads: [] as Record<string, unknown>[] }));

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
      callback(null, {});
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

  it("adds no replyTo when the template sets none", async () => {
    await new TestEmail({
      from: "Flowko <noreply@flowko.si>",
      to: "Janez <booker@example.si>",
      subject: "Rezervacija potrjena",
    }).sendEmail();

    expect(sentPayloads[0]).not.toHaveProperty("replyTo");
  });
});
