// Flowko U25: a desk-only placeholder address never gets a sign-in link mail (raw nodemailer bypasses BaseEmail's skip).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));

vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
  createTransport: () => ({ sendMail }),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = () => "<html>{{signin_url}}</html>";
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

import sendVerificationRequest from "./sendVerificationRequest";

describe("sendVerificationRequest", () => {
  beforeEach(() => sendMail.mockClear());

  const url = "http://localhost:3000/api/auth/callback/email?token=t";

  it("sends no mail to a desk-only placeholder address", async () => {
    await sendVerificationRequest({ identifier: "desk-1@flowko.invalid", url });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends no mail to a phone faux address", async () => {
    await sendVerificationRequest({ identifier: "38640123456@sms.cal.com", url });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("still sends to a normal address", async () => {
    await sendVerificationRequest({ identifier: "ana@flowko.si", url });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: "ana@flowko.si" });
  });
});
