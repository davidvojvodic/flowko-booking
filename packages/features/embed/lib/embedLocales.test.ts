import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Flowko U13-04: the Embed dialog's keys exist in English and Slovenian, and every English key has a
// Slovenian entry (validate_sl.py runs the full check on the Vault copy).

const load = (lang: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(__dirname, `../../../i18n/locales/${lang}/common.json`), "utf8"));
const en = load("en");
const sl = load("sl");

const DIALOG_KEYS = [
  "flowko_book_button",
  "embed",
  "embed_tab_html",
  "embed_theme",
  "embed_theme_auto",
  "embed_theme_dark",
  "embed_theme_light",
  "embed_window_sizing",
  "embed_width_short",
  "embed_height_short",
  "embed_button_text",
  "embed_display_calendar_icon",
  "embed_button_position",
  "embed_position_bottom_right",
  "embed_position_bottom_left",
  "embed_button_color",
  "embed_text_color",
  "embed_click_variant",
  "embed_click_variant_button",
  "embed_click_variant_link",
  "embed_hint_inline",
  "embed_hint_floating",
  "embed_hint_click_button",
  "embed_hint_click_link",
  "inline_embed",
  "floating_pop_up_button",
  "pop_up_element_click",
  "open_dialog_with_element_click",
  "light_brand_color",
  "dark_brand_color",
  "hide_eventtype_details",
  "layout",
  "copy_code",
  "code_copied",
  "minute_timeUnit",
  "preview",
];

describe("Embed dialog locales", () => {
  it.each(DIALOG_KEYS)("%s is in en and sl", (key) => {
    expect(typeof en[key]).toBe("string");
    expect(typeof sl[key]).toBe("string");
    expect((sl[key] as string).trim()).not.toBe("");
  });

  it("every English key has a Slovenian entry", () => {
    expect(Object.keys(en).filter((key) => !(key in sl))).toEqual([]);
  });

  it("uses Flowko's terms, with lowercase vi/vaš inside a sentence", () => {
    expect(sl.embed).toBe("Vgradnja");
    expect(sl.pop_up_element_click).toBe("Pojavno okno ob kliku na vaš gumb");
    expect(sl.flowko_book_button).toBe("Rezervirajte termin");
    expect(en.flowko_book_button).toBe("Book an appointment");
    const midSentenceCapital = /(?<![.!?:]\s)(?<!^)\b(Vaš|Vaša|Vaše|Vašo|Vašega|Vaših|Vam|Vas|Vi|Vami)\b/;
    for (const key of DIALOG_KEYS) {
      expect(sl[key] as string, key).not.toMatch(midSentenceCapital);
    }
    const slText = JSON.stringify(Object.fromEntries(DIALOG_KEYS.map((key) => [key, sl[key]])));
    expect(slText).not.toMatch(/Vdela|vdela/);
    expect(slText).not.toMatch(/\bCal\b/);
  });

  it("the click-link hint keeps its {{url}} placeholder", () => {
    expect(en.embed_hint_click_link).toContain("{{url}}");
    expect(sl.embed_hint_click_link).toContain("{{url}}");
  });
});
