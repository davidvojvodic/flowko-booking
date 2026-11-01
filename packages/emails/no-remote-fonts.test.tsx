/**
 * U15: a mail never loads a font from Google. A mail client that follows such a link hands the recipient's
 * IP address to Google (David, 2026-11-01). Text uses the stacks already in the templates: Roboto where the
 * reader has it, otherwise Helvetica or Arial.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import EmailHead from "./src/components/EmailHead";

const FONT_HOST = /fonts\.(googleapis|gstatic)\.com/i;

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? filesUnder(file) : [file];
  });

describe("mails load no remote fonts", () => {
  it("the shared head of every React mail names no font host", () => {
    const html = renderToStaticMarkup(<EmailHead title="t" />);
    expect(html).toContain("<title>t</title>");
    expect(html).not.toMatch(FONT_HOST);
  });

  it("no file in the mail sources names a font host", () => {
    const files = [
      ...filesUnder(path.join(__dirname, "src")),
      ...filesUnder(path.join(__dirname, "templates")),
    ];
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((file) => FONT_HOST.test(readFileSync(file, "utf8")))).toEqual([]);
  });
});
