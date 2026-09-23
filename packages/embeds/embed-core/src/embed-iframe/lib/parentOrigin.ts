/**
 * SDK events can carry booking details, so the iframe posts them only to the origin of the page that
 * embeds it. That origin is learned from the first message the parent sends (it answers
 * `__iframeReady`). Until then it comes from the browser: location.ancestorOrigins where supported,
 * otherwise document.referrer.
 */

// These carry no booking or user data and must reach the parent before it has sent anything.
// The referrer can't be used for them: after a navigation inside the iframe it names the iframe's own page.
const EVENTS_SENT_BEFORE_PARENT_ORIGIN_IS_KNOWN = [
  "__iframeReady",
  "__dimensionChanged",
  "__windowLoadComplete",
  "__routeChanged",
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
 * The targetOrigin for posting an SDK event to the parent, or null when the event must not be sent.
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
  if (EVENTS_SENT_BEFORE_PARENT_ORIGIN_IS_KNOWN.includes(eventType)) {
    return "*";
  }
  return toWebOrigin(referrer);
}
