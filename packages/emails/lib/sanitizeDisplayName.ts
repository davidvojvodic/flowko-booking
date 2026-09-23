const sanitizeDisplayName = (name: string) => {
  // \x00-\x1F and \x7F-\x9F are the Unicode control characters (\p{Cc}, which needs the ES6 u flag).
  const charsToReplace = /[;,"<>():\x00-\x1F\x7F-\x9F]/g;

  return name.replace(charsToReplace, " ").replace(/\s+/g, " ").trim();
};

// RFC 5322 dot-atom, plus the non-ASCII characters RFC 6532 allows in it.
const DOT_ATOM = /^[\w!#$%&'*+/=?^`{|}~\u00A0-\uFFFF-]+(\.[\w!#$%&'*+/=?^`{|}~\u00A0-\uFFFF-]+)*$/;
const QUOTED_STRING = /^"(?:[^"\\]|\\[\s\S])*"$/;

// Nodemailer quotes a local part only when it contains a space, so `a,b@example.org` reached the
// To header unquoted and stricter parsers read it as several addresses. The domain is whatever
// follows the last "@"; everything before it is quoted unless it is already a plain local part.
const toAddrSpec = (address: string) => {
  const cleaned = address
    .replace(/[<>]/g, "")
    .replace(/[\x00-\x1F\x7F-\x9F]+/g, " ")
    .trim();
  const at = cleaned.lastIndexOf("@");
  const local = cleaned.slice(0, at);

  if (at < 1 || DOT_ATOM.test(local) || QUOTED_STRING.test(local)) return cleaned;

  return `"${local.replace(/["\\]/g, "\\$&")}"${cleaned.slice(at)}`;
};

export type MailAddress = { name: string; address: string };

/**
 * Turns an address field built by a template into nodemailer address objects. Given a string,
 * nodemailer parses the display name as an address list, so a booker named
 * `x <someone@example.org>, y` became an extra recipient. Given objects, it only encodes the name.
 *
 * - A field containing "<" or ">" is always exactly one mailbox: the address is what follows the
 *   last "<". Booking-form emails cannot contain either character, while the name in front of them
 *   can be booker input containing anything. A faux email built from a phone number, which could
 *   carry ">" and "," before the digits-only fix, is never split into a list either. A named list
 *   such as `A <a@x>, B <b@x>` therefore only reaches the last address.
 * - Anything else is a list of bare addresses separated by "," or ";", such as
 *   `toAddresses.join(",")`. As in nodemailer, an entry without "@" is not an address.
 */
export const toMailAddresses = (field: string): MailAddress[] => {
  if (/[<>]/.test(field)) {
    const lastOpen = field.lastIndexOf("<");
    const address = toAddrSpec(field.slice(lastOpen + 1));
    const name = lastOpen === -1 ? "" : field.slice(0, lastOpen);

    return address ? [{ name: sanitizeDisplayName(name), address }] : [];
  }

  return field
    .split(/[,;]/)
    .map(toAddrSpec)
    .filter((address) => address.includes("@"))
    .map((address) => ({ name: "", address }));
};
