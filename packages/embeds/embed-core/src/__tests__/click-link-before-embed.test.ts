/**
 * Flowko C2 (R29): the click-link code as a client's page runs it: the code first, embed.js later, or never.
 * A file of its own, so that embed.ts is imported fresh after the code ran (vitest gives each test file its own
 * jsdom window and module registry). jsdom does not fetch the embed.js the loader appends.
 */
import "../../test/__mocks__/windowMatchMedia";

import { describe, expect, it, vi } from "vitest";

import { buildFlowkoSnippet, getFlowkoNamespace } from "@calcom/features/embed/lib/buildFlowkoSnippet";

vi.mock("../tailwindCss", () => ({
  default: "mockedTailwindCss",
}));

const BOOKER_ORIGIN = "https://booking.example.com";
const CAL_LINK = "flowko-test/prej";
const NAMESPACE = getFlowkoNamespace("click-link", "prej");

/** As embed-host-page.test.ts: defaultPrevented is read on window, then the click is cancelled for jsdom. */
function click(el: Element) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  let defaultPrevented: boolean | null = null;
  const afterListeners = (e: Event) => {
    defaultPrevented = e.defaultPrevented;
    e.preventDefault();
  };
  window.addEventListener("click", afterListeners);
  el.dispatchEvent(event);
  window.removeEventListener("click", afterListeners);
  if (defaultPrevented === null) throw new Error("the click did not bubble to window");
  return defaultPrevented as boolean;
}

const modalBoxes = () => document.querySelectorAll("cal-modal-box").length;

describe("C2: the click-link code before and after embed.js", () => {
  it("is an ordinary link until embed.js has run, then opens one window per click", async () => {
    vi.stubEnv("EMBED_PUBLIC_WEBAPP_URL", BOOKER_ORIGIN);
    const html = buildFlowkoSnippet({
      type: "click-link",
      calLink: CAL_LINK,
      namespace: "prej",
      origin: BOOKER_ORIGIN,
      embedLibUrl: `${BOOKER_ORIGIN}/embed/embed.js`,
    });
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error("the click-link snippet has no script");
    new Function(script)();
    const link = document.body.appendChild(document.createElement("a"));
    link.href = `${BOOKER_ORIGIN}/${CAL_LINK}`;
    link.textContent = "Rezervirajte";

    // The code ran, embed.js has not: the loader queued initNamespace and added the embed.js tag
    const ns = () => (window.Cal as unknown as { ns: Record<string, { instance?: unknown }> }).ns[NAMESPACE];
    expect(ns().instance).toBeUndefined();
    expect(document.querySelectorAll(`script[src="${BOOKER_ORIGIN}/embed/embed.js"]`)).toHaveLength(1);
    expect(click(link)).toBe(false);
    expect(modalBoxes()).toBe(0);

    // embed.js runs: the namespace has its instance as soon as the import returns, and the earlier click
    // left nothing queued, so no window opens by itself
    const { Cal } = await import("../embed");
    expect(ns().instance).toBeInstanceOf(Cal);
    expect(modalBoxes()).toBe(0);

    expect(click(link)).toBe(true);
    expect(modalBoxes()).toBe(1);
    const iframe = document.querySelector("cal-modal-box iframe") as HTMLIFrameElement;
    expect(new URL(iframe.src).pathname).toBe(`/${CAL_LINK}/embed`);
    expect(new URL(iframe.src).searchParams.get("embed")).toBe(NAMESPACE);
  });
});
