// Flowko U27: the customer of a business booking (W4). The desk types a name and an e-mail address and/or a
// phone number; the booking writer needs a name, a normalised e-mail or phone, and the attendee address Cal's
// booking needs (a phone-only customer gets Cal's own sms.cal.com address, which Cal never mails). Pure; every
// refusal is FlowkoBusinessError("bad_customer"), whose message carries no data. Server only.
import { contructEmailFromPhoneNumber } from "@calcom/lib/contructEmailFromPhoneNumber";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";
import { FlowkoBusinessError } from "./errors";

export type CustomerInput = { name: string; email?: string | null; phone?: string | null };
export type Customer = { name: string; email: string | null; phone: string | null; attendeeEmail: string };

const NAME_MAX = 80;
const EMAIL_MAX = 254;
/** The desk-only placeholder domain (U25) and Cal's phone-only attendee domain are never a customer's e-mail. */
const REFUSED_EMAIL_DOMAINS = ["@flowko.invalid", "@sms.cal.com"];
const DEFAULT_COUNTRY = "SI";

const emailSchema = z.string().email();

function parseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > EMAIL_MAX || !emailSchema.safeParse(email).success) {
    throw new FlowkoBusinessError("bad_customer");
  }
  if (REFUSED_EMAIL_DOMAINS.some((domain) => email.endsWith(domain))) {
    throw new FlowkoBusinessError("bad_customer");
  }
  return email;
}

function parsePhone(raw: string): string {
  const parsed = parsePhoneNumberFromString(raw.trim(), DEFAULT_COUNTRY);
  if (!parsed || !parsed.isValid()) throw new FlowkoBusinessError("bad_customer");
  return parsed.number;
}

/**
 * W4: name trimmed, 1–80 characters; e-mail optional (lowercased, valid, not a placeholder domain); phone
 * optional (parsed with default country SI to E.164, must be valid); at least one of e-mail and phone. The
 * attendee address is the e-mail, else the address Cal builds from the phone.
 */
export function parseCustomer(input: CustomerInput): Customer {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > NAME_MAX) throw new FlowkoBusinessError("bad_customer");

  const rawEmail = typeof input.email === "string" ? input.email.trim() : "";
  const rawPhone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (rawEmail === "" && rawPhone === "") throw new FlowkoBusinessError("bad_customer");

  const email = rawEmail === "" ? null : parseEmail(rawEmail);
  const phone = rawPhone === "" ? null : parsePhone(rawPhone);
  const attendeeEmail = email ?? contructEmailFromPhoneNumber(phone as string);
  return { name, email, phone, attendeeEmail };
}
