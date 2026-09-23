// The address is the last <...> in the field: emails cannot contain "<" or ">", while the name in
// front of them can be booker input containing anything, commas and angle brackets included.
const SINGLE_MAILBOX = /^([\s\S]*)<([^<>]*)>\s*$/;

const sanitizeDisplayName = (name: string) => {
  // \x00-\x1F and \x7F-\x9F are the Unicode control characters (\p{Cc}, which needs the ES6 u flag).
  const charsToReplace = /[;,"<>():\x00-\x1F\x7F-\x9F]/g;

  return name.replace(charsToReplace, " ").replace(/\s+/g, " ").trim();
};

export type MailAddress = { name: string; address: string };

/**
 * Turns an address field built by a template into nodemailer address objects. Given a string,
 * nodemailer parses the display name as an address list, so a booker named
 * `x <someone@example.org>, y` became an extra recipient. Given objects, it only encodes the name.
 *
 * - "Name <email>" is always exactly one mailbox, whatever the name contains.
 * - Anything else is a list of bare addresses separated by "," or ";", such as
 *   `toAddresses.join(",")`. As in nodemailer, an entry without "@" is not an address.
 */
export const toMailAddresses = (field: string): MailAddress[] => {
  const mailbox = field.match(SINGLE_MAILBOX);

  if (mailbox) {
    const address = mailbox[2].trim();
    return address ? [{ name: sanitizeDisplayName(mailbox[1]), address }] : [];
  }

  return field
    .split(/[,;]/)
    .map((address) => address.trim())
    .filter((address) => address.includes("@"))
    .map((address) => ({ name: "", address }));
};
