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

    it("keeps a comma in the booker's local part inside one address", async () => {
      const sent = await sendTo("Janez <janez,novak@example.si>");

      expect(sent.envelope).toEqual(["janez,novak@example.si"]);
      expect(sent.header).toEqual(["janez,novak@example.si"]);
    });

    it("returns no recipient when the address is empty", () => {
      expect(toMailAddresses(`Janez <${ATTACKER}>, x <>`)).toEqual([]);
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
