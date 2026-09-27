/**
 * Flowko U13-14: the words embed.js itself shows on a client's website: the iframe title, the modal's
 * close button, the loading skeleton's month buttons, the error text and the floating button's
 * default text. The booking page inside the iframe has its own translations.
 *
 * The language follows the host page's <html lang>: Slovenian for Slovenian ("sl", with or without a
 * region such as "sl-SI") and for a page that declares no language, since Flowko's clients are
 * Slovenian; English for every other language. It is read each time a string is used, so a site
 * that sets its lang attribute after load still gets the right language.
 *
 * Only embed.ts and the modules it imports may use this file: preview.ts must not share a module with
 * embed.ts (see ./previewPage), so its button text repeats the rule in getPreviewButtonText.
 */
export type EmbedLanguage = "sl" | "en";

const EMBED_STRINGS = {
  sl: {
    iframeTitle: "Rezervacija termina",
    close: "Zapri",
    previousMonth: "Prikaži prejšnji mesec",
    nextMonth: "Prikaži naslednji mesec",
    somethingWentWrong: "Nekaj je šlo narobe.",
    errorCode: "Koda napake",
    bookingPageNotFound: "Ta stran za rezervacijo ne obstaja.",
    bookButton: "Rezervirajte termin",
  },
  en: {
    iframeTitle: "Appointment booking",
    close: "Close",
    previousMonth: "View previous month",
    nextMonth: "View next month",
    somethingWentWrong: "Something went wrong.",
    errorCode: "Error code",
    bookingPageNotFound: "This booking page does not exist.",
    bookButton: "Book an appointment",
  },
} as const;

export type EmbedStrings = (typeof EMBED_STRINGS)[EmbedLanguage];

function getHostPageLang(): string {
  if (typeof document === "undefined" || !document.documentElement) {
    return "";
  }
  return document.documentElement.lang || "";
}

/**
 * "sl", "sl-SI", "SL", "sl_SI" and the ISO 639-2 code "slv" are Slovenian. An empty or missing lang
 * is Slovenian too. Anything else, Slovak ("sk", "slk") included, is English.
 */
export function getEmbedLanguage(htmlLang: string | null | undefined = getHostPageLang()): EmbedLanguage {
  const primarySubtag = (htmlLang || "").trim().toLowerCase().split(/[-_]/)[0];
  if (!primarySubtag) {
    return "sl";
  }
  return primarySubtag === "sl" || primarySubtag === "slv" ? "sl" : "en";
}

export function getEmbedStrings(language: EmbedLanguage = getEmbedLanguage()): EmbedStrings {
  return EMBED_STRINGS[language];
}
