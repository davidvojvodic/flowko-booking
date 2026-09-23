/**
 * @vitest-environment node
 */
import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser";
import { describe, expect, it } from "vitest";

import { toMailAddresses } from "./sanitizeDisplayName";

const BOOKER = "booker@example.si";
const ATTACKER = "attacker-target@example.org";

const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });

// The envelope decides who receives the email; the To header is what receiving servers and mail
// clients parse again.
const sendTo = async (to: string, subject = "Rezervacija potrjena") => {
  const info = await transport.sendMail({
    from: "noreply@flowko.si",
    to: toMailAddresses(to),
    subject,
    text: "Test",
  });
  const headers = info.message
    .toString()
    .split("\r\n\r\n")[0]
    .replace(/\r\n[ \t]+/g, " ")
    .split("\r\n");
  const toHeader = headers.find((header) => header.startsWith("To: ")) ?? "";

  return {
    envelope: info.envelope.to,
    header: addressparser(toHeader.slice("To: ".length), { flatten: true }).map(({ address }) => address),
    headers,
  };
};

describe("toMailAddresses", () => {
  describe("a booker name in `${attendee.name} <${attendee.email}>`", () => {
    it.each([
      ["angle brackets", `Janez <${ATTACKER}>, x`],
      ["a newline", `Janez\n<${ATTACKER}>, x`],
      ["quotes", `Janez" <${ATTACKER}>, "x`],
      ["CRLF", `Janez\r\n<${ATTACKER}>, x`],
      ["a CRLF header line", `Janez\r\nBcc: ${ATTACKER}`],
      ["a lone CR", `Janez\r<${ATTACKER}>,x`],
      ["a semicolon", `Janez <${ATTACKER}>; x`],
      ["group syntax", `x: ${ATTACKER};`],
      ["a comment", `Janez (${ATTACKER}), x`],
      ["an address", ATTACKER],
      ["an address and a comma", `Janez ${ATTACKER}, x`],
      ["10,000 characters", `${"A".repeat(10000)} <${ATTACKER}>, x`],
      ["unicode", `Žiga <${ATTACKER}>, Čebašek`],
    ])("with %s still reaches only the booker", async (_, name) => {
      const to = `${name} <${BOOKER}>`;

      expect(toMailAddresses(to).map(({ address }) => address)).toEqual([BOOKER]);

      const sent = await sendTo(to);
      expect(sent.envelope).toEqual([BOOKER]);
      expect(sent.header).toEqual([BOOKER]);
      expect(sent.headers.some((header) => /^bcc:/i.test(header))).toBe(false);
    });

    it.each([
      ["Janez Novak", "Janez Novak"],
      ["Novak, Janez", "Novak Janez"],
      ["Čebašek", "Čebašek"],
      ["Žiga Čebašek", "Žiga Čebašek"],
      ["", ""],
      [" \t ", ""],
      ["\r\n", ""],
      ["Ja\u0000nez", "Ja nez"],
    ])("%j reaches the booker as %j", async (name, expectedName) => {
      const to = `${name} <${BOOKER}>`;

      expect(toMailAddresses(to)).toEqual([{ name: expectedName, address: BOOKER }]);

      const sent = await sendTo(to);
      expect(sent.envelope).toEqual([BOOKER]);
      expect(sent.header).toEqual([BOOKER]);
    });

    it("quotes a comma in the booker's local part so it stays one address", async () => {
      const to = "Janez <janez,novak@example.si>";

      expect(toMailAddresses(to)).toEqual([{ name: "Janez", address: '"janez,novak"@example.si' }]);

      const sent = await sendTo(to);
      expect(sent.envelope).toEqual(['"janez,novak"@example.si']);
      expect(sent.header).toEqual(['"janez,novak"@example.si']);
    });

    it("returns no recipient when the address is empty", () => {
      expect(toMailAddresses(`Janez <${ATTACKER}>, x <>`)).toEqual([]);
    });
  });

  // Phone-only bookings get `${phone}@sms.cal.com` as their email. Before contructEmailFromPhoneNumber
  // kept only the digits, a phone number that passes isValidPhoneNumber could carry ";isub=" and any
  // characters after it, and bookings stored then still hold such addresses.
  describe("a faux email built from a phone number with an ;isub= extension", () => {
    const legacyFauxEmail = (phone: string) => `${phone.replace(/\+/g, "")}@sms.cal.com`;

    it.each([
      ["a comma list after >", `+38640123456;isub=>,${ATTACKER},x`],
      ["a semicolon list after >", `+38640123456;isub=>;${ATTACKER};x`],
      ["a spaced list after >", `+38640123456;isub=>, ${ATTACKER} ,x`],
      ["an angle-bracket address", `+38640123456;isub=<${ATTACKER}>`],
      ["quotes around a list", `+38640123456;isub=",${ATTACKER},"x`],
      ["a CRLF header line", `+38640123456;isub=x\r\nBcc: ${ATTACKER}`],
      ["a backslash before a quote", `+38640123456;isub=\\",${ATTACKER},x`],
    ])("with %s stays one address at sms.cal.com", async (_, phone) => {
      const to = `Janez <${legacyFauxEmail(phone)}>`;

      const addresses = toMailAddresses(to);
      expect(addresses).toHaveLength(1);
      expect(addresses[0].address).toMatch(/^"[^\r\n]*"@sms\.cal\.com$/);

      const sent = await sendTo(to);
      expect(sent.envelope).toEqual([addresses[0].address]);
      expect(sent.header).toEqual([addresses[0].address]);
      expect(sent.headers.some((header) => /^bcc:/i.test(header))).toBe(false);
    });

    it("is not split into a list when the template passes it bare", () => {
      const faux = legacyFauxEmail(`+38640123456;isub=>,${ATTACKER},x`);

      expect(toMailAddresses(faux)).toEqual([
        { name: "", address: `"38640123456;isub=,${ATTACKER},x"@sms.cal.com` },
      ]);
    });
  });

  describe("a list of bare addresses", () => {
    it("keeps every address of a joined list", async () => {
      const to = ["organizer@flowko.si", "member@flowko.si"].join(",");

      expect(toMailAddresses(to)).toEqual([
        { name: "", address: "organizer@flowko.si" },
        { name: "", address: "member@flowko.si" },
      ]);

      const sent = await sendTo(to);
      expect(sent.envelope).toEqual(["organizer@flowko.si", "member@flowko.si"]);
      expect(sent.header).toEqual(["organizer@flowko.si", "member@flowko.si"]);
    });

    it("keeps every address of a getReplyToHeader list", () => {
      const replyTo = ["guest@example.si", "second@example.si", "organizer@flowko.si"].join(", ");

      expect(toMailAddresses(replyTo).map(({ address }) => address)).toEqual([
        "guest@example.si",
        "second@example.si",
        "organizer@flowko.si",
      ]);
    });

    it("splits on semicolons and skips entries without @, as nodemailer does", () => {
      expect(toMailAddresses("a@flowko.si; b@flowko.si").map(({ address }) => address)).toEqual([
        "a@flowko.si",
        "b@flowko.si",
      ]);
      expect(toMailAddresses("janez,novak@example.si").map(({ address }) => address)).toEqual([
        "novak@example.si",
      ]);
    });

    it("still delivers `${organizer.email}>` to the organizer", async () => {
      const sent = await sendTo("organizer@flowko.si>");

      expect(sent.envelope).toEqual(["organizer@flowko.si"]);
    });

    it("sends from the address of an EMAIL_FROM that carries its own name", () => {
      expect(toMailAddresses("Salon Ana <Flowko <rezervacije@flowko.si>>")).toEqual([
        { name: "Salon Ana Flowko", address: "rezervacije@flowko.si" },
      ]);
    });
  });

  // Subjects carry booker and organizer names too. They are not converted here because nodemailer
  // already replaces CR/LF in every non-address header; this guards that assumption on upgrades.
  it("relies on nodemailer to keep CR/LF in the subject from starting a header", async () => {
    const sent = await sendTo(`Janez <${BOOKER}>`, `Sestanek\r\nBcc: ${ATTACKER}`);

    expect(sent.headers).toContain(`Subject: Sestanek Bcc: ${ATTACKER}`);
    expect(sent.headers.some((header) => /^bcc:/i.test(header))).toBe(false);
    expect(sent.envelope).toEqual([BOOKER]);
  });
});
