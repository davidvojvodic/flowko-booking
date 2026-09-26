/**
 * Flowko U13-07: embed.js runs on clients' websites. Nothing compiled into it may load a resource
 * from a third-party host (a remote font would send every visitor's IP address to that host), and
 * it must not reference any cal.com origin.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromSrc = createRequire(path.join(srcDir, "styles.css"));

// A scheme-relative or absolute URL on cal.com or any of its subdomains (app.cal.com, ...).
const CAL_COM_ORIGIN = /(?:https?:)?\/\/(?:[a-z0-9-]+\.)*cal\.com(?![a-z0-9-])/i;
// url(...) whose target is not local: http(s)://, scheme-relative //, or any other scheme but data:.
const REMOTE_CSS_URL = /url\(\s*['"]?\s*(?:\/\/|(?!data:)[a-z][a-z0-9+.-]*:)/i;
// @import "https://..." / @import url(https://...) / @import "//..."
const REMOTE_CSS_IMPORT = /@import\s+(?:url\(\s*)?['"]?\s*(?:\/\/|[a-z][a-z0-9+.-]*:)/i;

function read(file: string) {
  return fs.readFileSync(file, "utf8");
}

/** Source files that can end up in embed.js (tests and the gitignored Tailwind output excluded). */
function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : listSourceFiles(full);
    }
    if (!/\.(ts|tsx|css)$/.test(entry.name)) return [];
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) return [];
    if (entry.name === "tailwind.generated.css") return [];
    return [full];
  });
}

/** The CSS files styles.css pulls in, resolved the way the Tailwind build resolves them. */
function resolveStylesImports(): string[] {
  const stylesCss = read(path.join(srcDir, "styles.css"));
  const specifiers = [...stylesCss.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return specifiers
    .filter((spec) => spec !== "tailwindcss")
    .map((spec) => (spec.startsWith(".") ? path.resolve(srcDir, spec) : requireFromSrc.resolve(spec)));
}

describe("embed-core has no third-party resources (U13-07)", () => {
  it("styles.css declares no @font-face, no remote url() and no Cal Sans heading font", () => {
    const css = read(path.join(srcDir, "styles.css"));

    expect(css).not.toMatch(/@font-face/i);
    expect(css).not.toMatch(REMOTE_CSS_URL);
    expect(css).not.toMatch(REMOTE_CSS_IMPORT);
    expect(css).not.toMatch(/cal\.ttf/i);
    expect(css).not.toMatch(/Cal Sans/i);
    expect(css).not.toMatch(/cal\.com/i);
  });

  it("no CSS bundled into embed.js loads a remote url() or declares a remote @font-face", () => {
    const imported = resolveStylesImports();
    // The package import and the shared tokens must both be followed, or this check is vacuous.
    expect(imported.some((file) => file.endsWith(path.join("config", "theme", "tokens.css")))).toBe(true);
    expect(imported.length).toBeGreaterThanOrEqual(2);

    const cssFiles = [
      path.join(srcDir, "styles.css"),
      path.join(srcDir, "embed.css"),
      path.join(srcDir, "loader.css"),
      ...imported,
    ];

    for (const file of cssFiles) {
      const css = read(file);
      expect({ file, remoteUrl: REMOTE_CSS_URL.test(css) }).toEqual({ file, remoteUrl: false });
      expect({ file, remoteImport: REMOTE_CSS_IMPORT.test(css) }).toEqual({ file, remoteImport: false });
      expect({ file, fontFace: /@font-face/i.test(css) }).toEqual({ file, fontFace: false });
    }
  });

  it("no embed-core source file references a cal.com origin or cal.ttf", () => {
    const files = listSourceFiles(srcDir);
    // Guard against a vacuous pass: the files that build embed.js must be in the scan.
    for (const required of ["embed.ts", "styles.css", "embed.css", "loader.css", "preview.ts"]) {
      expect(files).toContain(path.join(srcDir, required));
    }

    const offenders = files
      .filter((file) => {
        const content = read(file);
        return CAL_COM_ORIGIN.test(content) || /cal\.ttf/i.test(content);
      })
      .map((file) => path.relative(srcDir, file));

    expect(offenders).toEqual([]);
  });

  it("the cal.com origin pattern catches the shapes it must catch", () => {
    for (const hit of [
      "https://cal.com/cal.ttf",
      '"https://cal.com"',
      "https://app.cal.com",
      "//cal.com/x",
      "http://CAL.COM",
    ]) {
      expect({ hit, matched: CAL_COM_ORIGIN.test(hit) }).toEqual({ hit, matched: true });
    }
    for (const miss of ["https://booking.flowko.si", "https://cal.community", "cal.com has rewrite issues"]) {
      expect({ miss, matched: CAL_COM_ORIGIN.test(miss) }).toEqual({ miss, matched: false });
    }
    expect(REMOTE_CSS_URL.test('src: url("https://example.com/font.ttf")')).toBe(true);
    expect(REMOTE_CSS_URL.test("url(//example.com/font.ttf)")).toBe(true);
    expect(REMOTE_CSS_URL.test("url(data:image/svg+xml;base64,AAAA)")).toBe(false);
    expect(REMOTE_CSS_URL.test('url("./local.svg")')).toBe(false);
    expect(REMOTE_CSS_IMPORT.test('@import url("https://fonts.example.com/css")')).toBe(true);
    expect(REMOTE_CSS_IMPORT.test('@import "../../../config/theme/tokens.css";')).toBe(false);
  });
});
