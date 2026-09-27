/**
 * Flowko U13-16: preview.html (the Embed dialog's live preview) loads embed.js and the booking page
 * only from the app itself, and takes instructions only from the dialog.
 */
import "../../test/__mocks__/windowMatchMedia";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAllowedBookerOrigin,
  getHttpOrigin,
  isAllowedEmbedLibUrl,
  isFramedByWebapp,
  isMessageFromWebapp,
} from "../lib/previewPage";

const WEBAPP_URL = "https://booking.flowko.si";
const EMBED_LIB_URL = `${WEBAPP_URL}/embed/embed.js`;

describe("previewPage helpers", () => {
  it("getHttpOrigin", () => {
    expect(getHttpOrigin("https://booking.flowko.si/event-types/1?tab=embed")).toBe(WEBAPP_URL);
    expect(getHttpOrigin("http://localhost:3000/x")).toBe("http://localhost:3000");
    for (const value of ["", null, undefined, "not a url", "about:blank", "javascript:alert(1)", "data:text/html,x"]) {
      expect(getHttpOrigin(value)).toBeNull();
    }
  });

  describe("isFramedByWebapp", () => {
    it("accepts a frame whose referrer is a page on the app's origin", () => {
      expect(
        isFramedByWebapp({ isTopLevel: false, referrer: `${WEBAPP_URL}/event-types/12?dialog=embed`, webappUrl: WEBAPP_URL })
      ).toBe(true);
    });

    it.each([
      // The upstream prefix check let these through
      "https://booking.flowko.si.attacker.example/",
      "https://booking.flowko.si@attacker.example/",
      // Other origins
      "https://attacker.example/",
      "https://flowko.si/",
      "https://www.booking.flowko.si/",
      "http://booking.flowko.si/",
      "https://booking.flowko.si:8443/",
      "",
    ])("rejects the referrer %o", (referrer) => {
      expect(isFramedByWebapp({ isTopLevel: false, referrer, webappUrl: WEBAPP_URL })).toBe(false);
    });

    it("rejects a top-level page", () => {
      expect(isFramedByWebapp({ isTopLevel: true, referrer: `${WEBAPP_URL}/`, webappUrl: WEBAPP_URL })).toBe(false);
    });
  });

  describe("isAllowedEmbedLibUrl", () => {
    it("accepts exactly the app's embed.js", () => {
      expect(isAllowedEmbedLibUrl({ embedLibUrl: EMBED_LIB_URL, expectedEmbedLibUrl: EMBED_LIB_URL })).toBe(true);
    });

    it.each([
      // The upstream last-two-labels check let any *.flowko.si through, and localhost always
      "https://attacker.flowko.si/embed/embed.js",
      "https://flowko.si/embed/embed.js",
      "http://localhost:3000/embed/embed.js",
      "http://127.0.0.1:8765/embed.js",
      // Same origin, other file
      `${WEBAPP_URL}/embed/preview.js`,
      `${EMBED_LIB_URL}?v=2`,
      `${WEBAPP_URL}/api/x`,
      "https://booking.flowko.si.attacker.example/embed/embed.js",
      "javascript:alert(1)",
      "",
      null,
    ])("rejects %o", (embedLibUrl) => {
      expect(isAllowedEmbedLibUrl({ embedLibUrl, expectedEmbedLibUrl: EMBED_LIB_URL })).toBe(false);
    });
  });

  describe("getAllowedBookerOrigin", () => {
    it.each([WEBAPP_URL, `${WEBAPP_URL}/`])("accepts %o as the app's origin", (bookerUrl) => {
      expect(getAllowedBookerOrigin({ bookerUrl, webappUrl: WEBAPP_URL })).toBe(WEBAPP_URL);
    });

    it.each([
      "https://booking.flowko.si.attacker.example",
      "https://attacker.flowko.si",
      "https://flowko.si",
      "http://booking.flowko.si",
      "http://localhost:3000",
      "javascript:alert(1)",
      "",
      null,
    ])("rejects %o", (bookerUrl) => {
      expect(getAllowedBookerOrigin({ bookerUrl, webappUrl: WEBAPP_URL })).toBeNull();
    });
  });

  describe("isMessageFromWebapp", () => {
    const parent = {} as Window;
    const otherWindow = {} as Window;

    it("accepts the parent page on the app's origin", () => {
      expect(isMessageFromWebapp({ origin: WEBAPP_URL, source: parent, parent, webappUrl: WEBAPP_URL })).toBe(true);
    });

    it.each([
      { origin: "https://attacker.example", source: parent },
      { origin: "https://booking.flowko.si.attacker.example", source: parent },
      { origin: WEBAPP_URL, source: otherWindow },
      { origin: WEBAPP_URL, source: null },
      { origin: "null", source: parent },
    ])("rejects origin $origin from another or no window", ({ origin, source }) => {
      expect(isMessageFromWebapp({ origin, source, parent, webappUrl: WEBAPP_URL })).toBe(false);
    });
  });
});

describe("preview.ts", () => {
  // jsdom's page origin; the test page is top-level, so window.parent === window stands in for the dialog
  const APP_ORIGIN = "http://localhost:3000";

  if (typeof globalThis.MediaQueryListEvent === "undefined") {
    // Not in jsdom; preview.ts builds one to apply the system colour scheme at start
    globalThis.MediaQueryListEvent = class extends Event {
      matches: boolean;
      media: string;
      constructor(type: string, init?: MediaQueryListEventInit) {
        super(type);
        this.matches = !!init?.matches;
        this.media = init?.media ?? "";
      }
    } as unknown as typeof MediaQueryListEvent;
  }

  function openPreview(query: Record<string, string>) {
    window.history.replaceState(null, "", `/embed/preview.html?${new URLSearchParams(query).toString()}`);
    return import("../preview");
  }

  const validQuery = {
    embedType: "inline",
    calLink: "flowko-test/ogled",
    embedLibUrl: `${APP_ORIGIN}/embed/embed.js`,
    bookerUrl: APP_ORIGIN,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("EMBED_PUBLIC_WEBAPP_URL", APP_ORIGIN);
    vi.stubEnv("EMBED_PUBLIC_EMBED_LIB_URL", "");
    // jsdom runs the test page top-level; the framing check is covered by isFramedByWebapp above
    vi.stubEnv("NEXT_PUBLIC_IS_E2E", "1");
    // @ts-expect-error - reset the loader between imports
    delete window.Cal;
    for (const script of Array.from(document.head.querySelectorAll("script"))) {
      script.remove();
    }
    document.body.innerHTML = `<div id="my-embed" style="width: 100%; height: 90%; overflow: scroll"></div>`;
    document.documentElement.removeAttribute("lang");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function loadedScripts() {
    return Array.from(document.head.querySelectorAll("script")).map((script) => script.src);
  }

  it("loads the app's embed.js (the default EMBED_LIB_URL) and books on the app's origin", async () => {
    await openPreview(validQuery);

    expect(loadedScripts()).toEqual([`${APP_ORIGIN}/embed/embed.js`]);
    const queue = (window.Cal as unknown as { q: unknown[][] }).q.map((args) => Array.from(args));
    expect(queue).toContainEqual(["init", { origin: APP_ORIGIN }]);
    expect(queue).toContainEqual([
      "inline",
      { elementOrSelector: "#my-embed", calLink: "flowko-test/ogled" },
    ]);
  });

  it.each([
    { embedLibUrl: "http://localhost:3000/embed/embed.js?x=1" },
    { embedLibUrl: "http://127.0.0.1:3000/embed/embed.js" },
    { embedLibUrl: "https://attacker.example/embed/embed.js" },
  ])("refuses embedLibUrl $embedLibUrl and loads no script", async ({ embedLibUrl }) => {
    await expect(openPreview({ ...validQuery, embedLibUrl })).rejects.toThrow('Invalid "embedLibUrl".');
    expect(loadedScripts()).toEqual([]);
  });

  it.each([{ bookerUrl: "http://localhost:3000.attacker.example" }, { bookerUrl: "https://attacker.example" }])(
    "refuses bookerUrl $bookerUrl and loads no script",
    async ({ bookerUrl }) => {
      await expect(openPreview({ ...validQuery, bookerUrl })).rejects.toThrow('Invalid "bookerUrl".');
      expect(loadedScripts()).toEqual([]);
    }
  );

  it("follows the dialog's instructions, and only the dialog's", async () => {
    await openPreview(validQuery);
    const embedEl = document.getElementById("my-embed") as HTMLElement;
    const dimensionUpdate = (width: string) => ({
      mode: "cal:preview",
      type: "inlineEmbedDimensionUpdate",
      data: { width, height: "400px" },
    });
    const otherFrame = document.createElement("iframe");
    document.body.appendChild(otherFrame);

    window.dispatchEvent(
      new MessageEvent("message", { data: dimensionUpdate("11px"), origin: "https://attacker.example", source: window })
    );
    window.dispatchEvent(
      new MessageEvent("message", { data: dimensionUpdate("12px"), origin: APP_ORIGIN, source: otherFrame.contentWindow })
    );
    expect(embedEl.style.width).toBe("100%");

    window.dispatchEvent(new MessageEvent("message", { data: dimensionUpdate("640px"), origin: APP_ORIGIN, source: window }));
    expect(embedEl.style.width).toBe("640px");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { mode: "cal:preview", type: "instruction", instruction: { name: "ui", arg: { theme: "light" } } },
        origin: APP_ORIGIN,
        source: window,
      })
    );
    const queue = (window.Cal as unknown as { q: unknown[][] }).q.map((args) => Array.from(args));
    expect(queue).toContainEqual(["ui", { theme: "light" }]);
  });

  it("element-click: the button reads „Rezervirajte termin“, or English with lang=en", async () => {
    await openPreview({ ...validQuery, embedType: "element-click" });
    expect(document.querySelector("button[data-cal-link]")?.textContent).toBe("Rezervirajte termin");

    vi.resetModules();
    // @ts-expect-error - reset the loader between imports
    delete window.Cal;
    document.body.innerHTML = "";
    await openPreview({ ...validQuery, embedType: "element-click", lang: "en" });
    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector("button[data-cal-link]")?.textContent).toBe("Book an appointment");
  });

  it("ignores a lang value that isn't a language tag", async () => {
    await openPreview({ ...validQuery, lang: '"><img src=x>' });
    expect(document.documentElement.hasAttribute("lang")).toBe(false);
  });
});
