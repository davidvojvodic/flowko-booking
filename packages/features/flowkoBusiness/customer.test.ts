// Flowko U27: W4 customer parsing (pure).
import { describe, expect, it } from "vitest";
import { parseCustomer } from "./customer";
import { FlowkoBusinessError } from "./errors";

const refused = (input: Parameters<typeof parseCustomer>[0]) => {
  try {
    parseCustomer(input);
  } catch (error) {
    expect(error).toBeInstanceOf(FlowkoBusinessError);
    return (error as FlowkoBusinessError).code;
  }
  return "no error";
};

describe("parseCustomer", () => {
  it("a Slovenian phone becomes E.164 and the attendee address is Cal's phone address", () => {
    expect(parseCustomer({ name: " Marija Novak ", phone: "041 123 456" })).toEqual({
      name: "Marija Novak",
      email: null,
      phone: "+38641123456",
      attendeeEmail: "38641123456@sms.cal.com",
    });
  });

  it("an e-mail is lowercased and is the attendee address", () => {
    expect(parseCustomer({ name: "Ana", email: " Ana@Example.com " })).toEqual({
      name: "Ana",
      email: "ana@example.com",
      phone: null,
      attendeeEmail: "ana@example.com",
    });
  });

  it("keeps both when both are given; the e-mail stays the attendee address", () => {
    expect(parseCustomer({ name: "Ana", email: "ana@example.com", phone: "+386 41 123 456" })).toEqual({
      name: "Ana",
      email: "ana@example.com",
      phone: "+38641123456",
      attendeeEmail: "ana@example.com",
    });
  });

  it("treats empty and null contact fields as missing", () => {
    expect(parseCustomer({ name: "Ana", email: "", phone: "041123456" }).email).toBeNull();
    expect(parseCustomer({ name: "Ana", email: null, phone: "041123456" }).email).toBeNull();
    expect(refused({ name: "Ana", email: "  ", phone: "" })).toBe("bad_customer");
  });

  it("refuses neither e-mail nor phone", () => {
    expect(refused({ name: "Ana" })).toBe("bad_customer");
    expect(refused({ name: "Ana", email: null, phone: null })).toBe("bad_customer");
  });

  it("refuses an invalid phone, even when a valid e-mail is given", () => {
    expect(refused({ name: "Ana", phone: "123" })).toBe("bad_customer");
    expect(refused({ name: "Ana", phone: "abc" })).toBe("bad_customer");
    expect(refused({ name: "Ana", email: "ana@example.com", phone: "123" })).toBe("bad_customer");
  });

  it("refuses an invalid e-mail and both placeholder domains", () => {
    expect(refused({ name: "Ana", email: "not-an-email" })).toBe("bad_customer");
    expect(refused({ name: "Ana", email: "x@flowko.invalid" })).toBe("bad_customer");
    expect(refused({ name: "Ana", email: "1@sms.cal.com" })).toBe("bad_customer");
    expect(refused({ name: "Ana", email: "1@SMS.cal.com" })).toBe("bad_customer");
  });

  it("refuses an empty or too long name; 80 characters pass", () => {
    expect(refused({ name: "", phone: "041123456" })).toBe("bad_customer");
    expect(refused({ name: "   ", phone: "041123456" })).toBe("bad_customer");
    expect(refused({ name: "a".repeat(81), phone: "041123456" })).toBe("bad_customer");
    expect(parseCustomer({ name: "a".repeat(80), phone: "041123456" }).name).toHaveLength(80);
  });

  it("the error message is the code and carries no customer data", () => {
    expect(() => parseCustomer({ name: "Secret Name", email: "secret@flowko.invalid" })).toThrow(
      /^bad_customer$/
    );
  });
});
