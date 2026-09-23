/**
 * SDK events can carry booking details, so the iframe posts them only to the origin of the page that
 * embeds it. That origin is learned from the first message the parent sends (it answers
 * `__iframeReady`). Until then it comes from the browser: location.ancestorOrigins where supported,
 * otherwise document.referrer.
 */

// Lifecycle events that carry no booking or personal data. They go to any origin when the parent's
// origin can't be pinned to a web origin: before the parent has sent anything, and for parents whose
// origin isn't http(s) (file:// pages, sandboxed iframes, capacitor://, app://, chrome-extension://).
// The embed's loader waits for them, so withholding them leaves the modal stuck on it.
// The referrer isn't used for them: after a navigation inside the iframe it names the iframe's own page.
const EVENTS_WITHOUT_PRIVATE_DATA = [
  "__iframeReady",
  "__dimensionChanged",
  "__windowLoadComplete",
  "__routeChanged",
  "__connectInitiated",
  "__connectCompleted",
  "__closeIframe",
  "__scrollByDistance",
  "linkReady",
  "linkPrerendered",
  // Its data.url is reduced to origin and path by the iframe, see getUrlWithoutQuery
  "linkFailed",
  "navigatedToBooker",
  "bookerViewed",
  "bookerReopened",
  "bookerReloaded",
  "bookerReady",
  "availabilityLoaded",
];

/**
 * Returns the http(s) origin of a URL or origin string, or null for anything else, including the
 * opaque origin "null", which postMessage can't target.
 */
export function toWebOrigin(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The page URL without its query and hash, which can carry prefilled names, emails and notes.
 */
export function getUrlWithoutQuery(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

/**
 * The targetOrigin for posting an SDK event to the parent, or null when the event can't be sent yet.
 */
export function getParentTargetOrigin({
  eventType,
  originLearnedFromParent,
  ancestorOrigin,
  referrer,
}: {
  eventType: string;
  originLearnedFromParent: string | null;
  ancestorOrigin: string | null | undefined;
  referrer: string | null | undefined;
}): string | null {
  if (originLearnedFromParent) {
    return originLearnedFromParent;
  }
  const originFromAncestors = toWebOrigin(ancestorOrigin);
  if (originFromAncestors) {
    return originFromAncestors;
  }
  if (EVENTS_WITHOUT_PRIVATE_DATA.includes(eventType)) {
    return "*";
  }
  return toWebOrigin(referrer);
}
