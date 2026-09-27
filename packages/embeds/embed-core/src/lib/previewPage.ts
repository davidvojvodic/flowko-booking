/**
 * Helpers for preview.ts, the script of preview.html: the live preview in the in-app Embed dialog.
 * The dialog, on WEBAPP_URL, frames it and passes the embed.js URL (`embedLibUrl`) and the booking
 * origin (`bookerUrl`) in its query.
 *
 * Flowko U13-16: the page loads that script on WEBAPP_URL's origin, so it must accept exactly the
 * dialog's values and nothing else. Upstream compared prefixes and the last two host labels, which
 * let `https://<WEBAPP_URL host>.evil.com` and every other subdomain of the parent domain through.
 *
 * Only preview.ts may import this module, and this module imports nothing. A module that embed.ts
 * imports as well would become a chunk shared by both builds, and embed.js must stay one
 * self-contained file.
 */

/** The origin of an http(s) URL, or null for anything else (unparsable, opaque, other schemes). */
export function getHttpOrigin(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const urlObject = new URL(url);
    return urlObject.protocol === "https:" || urlObject.protocol === "http:" ? urlObject.origin : null;
  } catch {
    return null;
  }
}

/** The page runs in a frame, and the page that framed it (its referrer) is on WEBAPP_URL's origin. */
export function isFramedByWebapp({
  isTopLevel,
  referrer,
  webappUrl,
}: {
  isTopLevel: boolean;
  referrer: string;
  webappUrl: string;
}): boolean {
  const webappOrigin = getHttpOrigin(webappUrl);
  return !isTopLevel && !!webappOrigin && getHttpOrigin(referrer) === webappOrigin;
}

/** The embed.js URL is exactly the one the app is built with (EMBED_LIB_URL). */
export function isAllowedEmbedLibUrl({
  embedLibUrl,
  expectedEmbedLibUrl,
}: {
  embedLibUrl: string | null;
  expectedEmbedLibUrl: string;
}): boolean {
  return !!embedLibUrl && !!getHttpOrigin(expectedEmbedLibUrl) && embedLibUrl === expectedEmbedLibUrl;
}

/** The booking origin, or null unless `bookerUrl` is on WEBAPP_URL's origin. */
export function getAllowedBookerOrigin({
  bookerUrl,
  webappUrl,
}: {
  bookerUrl: string | null;
  webappUrl: string;
}): string | null {
  const webappOrigin = getHttpOrigin(webappUrl);
  const bookerOrigin = getHttpOrigin(bookerUrl);
  return webappOrigin && bookerOrigin === webappOrigin ? bookerOrigin : null;
}

/** A message the Embed dialog sent: from the parent window, on WEBAPP_URL's origin. */
export function isMessageFromWebapp({
  origin,
  source,
  parent,
  webappUrl,
}: {
  origin: string;
  source: MessageEventSource | null;
  parent: Window;
  webappUrl: string;
}): boolean {
  const webappOrigin = getHttpOrigin(webappUrl);
  return !!source && source === parent && !!webappOrigin && origin === webappOrigin;
}

/**
 * Flowko U13-14: the text of the preview's element-click button, the button the Embed dialog's code
 * gives the client. Same language rule as getEmbedLanguage in ./i18n (which this module can't
 * import): Slovenian for "sl"/"slv" with any region and for a page without a lang, else English.
 */
export function getPreviewButtonText(htmlLang: string | null | undefined): string {
  const primarySubtag = (htmlLang || "").trim().toLowerCase().split(/[-_]/)[0];
  const isSlovenian = !primarySubtag || primarySubtag === "sl" || primarySubtag === "slv";
  return isSlovenian ? "Rezervirajte termin" : "Book an appointment";
}
