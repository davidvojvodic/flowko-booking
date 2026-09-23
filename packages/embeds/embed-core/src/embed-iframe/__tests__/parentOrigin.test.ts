import { describe, expect, it } from "vitest";

import { getParentTargetOrigin, getUrlWithoutQuery, toWebOrigin } from "../lib/parentOrigin";

describe("toWebOrigin", () => {
  it("returns the origin of an http(s) URL", () => {
    expect(toWebOrigin("https://salon.example.si/narocanje?x=1")).toBe("https://salon.example.si");
    expect(toWebOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("returns null for opaque, non-web and invalid values", () => {
    expect(toWebOrigin("null")).toBeNull();
    expect(toWebOrigin("file:///tmp/page.html")).toBeNull();
    expect(toWebOrigin("not a url")).toBeNull();
    expect(toWebOrigin("")).toBeNull();
    expect(toWebOrigin(undefined)).toBeNull();
  });
});

describe("getParentTargetOrigin", () => {
  const unknownParent = { originLearnedFromParent: null, ancestorOrigin: undefined, referrer: "" };

  it("uses the origin learned from the parent's messages first", () => {
    expect(
      getParentTargetOrigin({
        eventType: "bookingSuccessful",
        originLearnedFromParent: "https://salon.example.si",
        ancestorOrigin: "https://other.example.com",
        referrer: "https://referrer.example.com/page",
      })
    ).toBe("https://salon.example.si");
  });

  it("falls back to the browser's ancestor origin", () => {
    expect(
      getParentTargetOrigin({
        ...unknownParent,
        eventType: "bookingSuccessful",
        ancestorOrigin: "https://salon.example.si",
        referrer: "https://referrer.example.com/page",
      })
    ).toBe("https://salon.example.si");
  });

  it("falls back to the referrer for events that can carry data", () => {
    expect(
      getParentTargetOrigin({
        ...unknownParent,
        eventType: "bookingSuccessful",
        referrer: "https://salon.example.si/narocanje",
      })
    ).toBe("https://salon.example.si");
  });

  it("never sends events that can carry data to an unknown origin", () => {
    for (const eventType of [
      "bookingSuccessful",
      "bookingSuccessfulV2",
      "rescheduleBookingSuccessful",
      "rescheduleBookingSuccessfulV2",
      "dryRunBookingSuccessfulV2",
      "dryRunRescheduleBookingSuccessfulV2",
      "bookingCancelled",
      "routed",
      "eventTypeSelected",
    ]) {
      expect(getParentTargetOrigin({ ...unknownParent, eventType })).toBeNull();
      expect(getParentTargetOrigin({ ...unknownParent, eventType, ancestorOrigin: "null" })).toBeNull();
      expect(
        getParentTargetOrigin({ ...unknownParent, eventType, ancestorOrigin: "file://", referrer: "" })
      ).toBeNull();
    }
  });

  it("lets data-free lifecycle events reach a parent whose origin can't be pinned", () => {
    // file:// pages, sandboxed iframes and app schemes: the loader waits for linkReady
    expect(
      getParentTargetOrigin({
        eventType: "linkReady",
        originLearnedFromParent: null,
        ancestorOrigin: "null",
        referrer: "",
      })
    ).toBe("*");
    for (const eventType of [
      "linkReady",
      "linkPrerendered",
      "linkFailed",
      "__connectInitiated",
      "__connectCompleted",
      "__closeIframe",
      "bookerViewed",
      "availabilityLoaded",
    ]) {
      expect(getParentTargetOrigin({ ...unknownParent, eventType })).toBe("*");
      expect(
        getParentTargetOrigin({ ...unknownParent, eventType, ancestorOrigin: "capacitor://localhost" })
      ).toBe("*");
    }
  });

  it("lets the data-free handshake events reach a parent whose origin isn't known yet", () => {
    for (const eventType of ["__iframeReady", "__dimensionChanged"]) {
      expect(getParentTargetOrigin({ ...unknownParent, eventType })).toBe("*");
      // A referrer can name the iframe's own previous page, so it is not used for the handshake
      expect(
        getParentTargetOrigin({ ...unknownParent, eventType, referrer: "https://booking.example.si/x" })
      ).toBe("*");
    }
  });

  it("pins the handshake events too once the parent's origin is known", () => {
    expect(
      getParentTargetOrigin({
        ...unknownParent,
        eventType: "__dimensionChanged",
        originLearnedFromParent: "https://salon.example.si",
      })
    ).toBe("https://salon.example.si");
  });
});

describe("getUrlWithoutQuery", () => {
  it("keeps only the origin and path", () => {
    expect(getUrlWithoutQuery("https://booking.example.si/salon/strizenje?email=a%40b.si&name=Ana#x")).toBe(
      "https://booking.example.si/salon/strizenje"
    );
    expect(getUrlWithoutQuery("not a url")).toBe("");
  });
});
