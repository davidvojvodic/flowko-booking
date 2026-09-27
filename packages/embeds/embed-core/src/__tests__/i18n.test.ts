/**
 * Flowko U13-14: the texts embed.js shows on a client's website follow the host page's <html lang>.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import inlineHtml from "../Inline/inlineHtml";
import modalBoxHtml from "../ModalBox/ModalBoxHtml";
import { getEmbedLanguage, getEmbedStrings } from "../lib/i18n";
import { getPreviewButtonText } from "../lib/previewPage";
import { getErrorString } from "../lib/utils";
import { generateSkeleton } from "../ui/skeleton";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

afterEach(() => {
  document.documentElement.removeAttribute("lang");
});

describe("getEmbedLanguage", () => {
  it.each(["", "   ", null, undefined, "sl", "SL", "sl-SI", "sl_SI", " sl-si ", "slv"])(
    "%o is Slovenian",
    (lang) => {
      expect(getEmbedLanguage(lang)).toBe("sl");
    }
  );

  it.each(["en", "en-US", "EN-gb", "de", "de-AT", "hr", "sr-Latn", "it", "sk", "slk", "x-slovenian"])(
    "%o is English",
    (lang) => {
      expect(getEmbedLanguage(lang)).toBe("en");
    }
  );

  it("reads <html lang> when called without an argument, each time", () => {
    expect(getEmbedLanguage()).toBe("sl");
    document.documentElement.lang = "en-US";
    expect(getEmbedLanguage()).toBe("en");
    expect(getEmbedStrings().bookButton).toBe("Book an appointment");
    document.documentElement.lang = "sl-SI";
    expect(getEmbedStrings().bookButton).toBe("Rezervirajte termin");
  });

  it("has the same keys in both languages, none of them empty", () => {
    const sl = getEmbedStrings("sl");
    const en = getEmbedStrings("en");
    expect(Object.keys(sl).sort()).toEqual(Object.keys(en).sort());
    for (const value of [...Object.values(sl), ...Object.values(en)]) {
      expect(value.trim()).not.toBe("");
    }
  });

  it("the preview page's button follows the same language rule as embed.js", () => {
    for (const lang of ["", "sl", "sl-SI", "SL_si", "slv", "en", "en-GB", "de", "sk", "slk"]) {
      expect(getPreviewButtonText(lang)).toBe(getEmbedStrings(getEmbedLanguage(lang)).bookButton);
    }
  });
});

describe("getErrorString", () => {
  it.each([
    {
      lang: "sl",
      code: "404",
      expected: "Koda napake: 404. Ta stran za rezervacijo ne obstaja.",
    },
    { lang: "sl", code: "500", expected: "Koda napake: 500. Nekaj je šlo narobe." },
    { lang: "sl", code: "routerError", expected: "Koda napake: routerError. Nekaj je šlo narobe." },
    { lang: "en", code: "404", expected: "Error code: 404. This booking page does not exist." },
    { lang: "en", code: "403", expected: "Error code: 403. Something went wrong." },
    { lang: "en", code: "routerError", expected: "Error code: routerError. Something went wrong." },
  ])("$lang $code", ({ lang, code, expected }) => {
    document.documentElement.lang = lang;
    const errorString = getErrorString({ errorCode: code, errorMessage: undefined });
    expect(errorString).toBe(expected);
    expect(errorString).not.toMatch(/cal link/i);
  });

  it("keeps a message that was passed in", () => {
    document.documentElement.lang = "sl";
    expect(getErrorString({ errorCode: "routerError", errorMessage: "Obrazec ni na voljo." })).toBe(
      "Koda napake: routerError. Obrazec ni na voljo."
    );
  });
});

describe("the markup embed.js renders", () => {
  it.each([
    { lang: "sl", previous: "Prikaži prejšnji mesec", next: "Prikaži naslednji mesec" },
    { lang: "en", previous: "View previous month", next: "View next month" },
  ])("skeleton month buttons in $lang", ({ lang, previous, next }) => {
    document.documentElement.lang = lang;
    const html = generateSkeleton({ layout: "month_view", pageType: null });
    expect(html).toContain(`aria-label="${previous}"`);
    expect(html).toContain(`aria-label="${next}"`);
  });

  it.each([
    { lang: "sl", close: "Zapri", error: "Nekaj je šlo narobe." },
    { lang: "en", close: "Close", error: "Something went wrong." },
  ])("modal close button and inline error text in $lang", ({ lang, close, error }) => {
    document.documentElement.lang = lang;
    expect(modalBoxHtml({ pageType: null, externalThemeClass: null as never })).toContain(
      `class="close" aria-label="${close}"`
    );
    expect(inlineHtml({ pageType: null, externalThemeClass: null as never })).toContain(error);
  });
});

describe("no English leftovers in the sources that build embed.js", () => {
  const files = [
    "embed.ts",
    "lib/utils.ts",
    "ModalBox/ModalBoxHtml.ts",
    "Inline/inlineHtml.ts",
    "ui/skeleton.ts",
    "FloatingButton/FloatingButtonHtml.ts",
    "preview.ts",
  ];

  it.each(files)("%s", (file) => {
    const source = fs.readFileSync(path.join(srcDir, file), "utf8");
    for (const leftover of [
      "Book my Cal",
      "Book a call",
      "Cal Link",
      "Something went wrong",
      'aria-label="Close"',
      "View previous month",
      "View next month",
      "I am a button",
    ]) {
      expect(source, `${file} contains "${leftover}"`).not.toContain(leftover);
    }
  });

  it('embed.ts sets no allow="payment" (U13-17)', () => {
    const source = fs.readFileSync(path.join(srcDir, "embed.ts"), "utf8");
    expect(source).not.toMatch(/setAttribute\(\s*["']allow["']/);
  });
});
