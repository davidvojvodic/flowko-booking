import { describe, expect, it } from "vitest";

import { contructEmailFromPhoneNumber } from "./contructEmailFromPhoneNumber";

describe("contructEmailFromPhoneNumber", () => {
  it("keeps an E.164 number as it was", () => {
    expect(contructEmailFromPhoneNumber("+38640123456")).toBe("38640123456@sms.cal.com");
  });

  // isValidPhoneNumber accepts all of these, so they can reach a phone-only booking.
  it.each([
    ["+38640123456;isub=>,attacker-target@example.org,x", "38640123456@sms.cal.com"],
    ["+38640123456;isub=<attacker-target@example.org>", "38640123456@sms.cal.com"],
    ["+38640123456;isub=x\r\nBcc: attacker-target@example.org", "38640123456@sms.cal.com"],
    ["+386 40 123 456", "38640123456@sms.cal.com"],
  ])("keeps only the digits of %j", (phoneNumber, email) => {
    expect(contructEmailFromPhoneNumber(phoneNumber)).toBe(email);
  });
});
