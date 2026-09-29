/**
 * Flowko U13-13, U13-14, U13-15: embed.js as it runs on a client's website, loaded by the real
 * loader snippet (the IIFE the Embed dialog writes, without the <script> it appends).
 */
import "../../test/__mocks__/windowMatchMedia";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowkoSnippetType } from "@calcom/features/embed/lib/buildFlowkoSnippet";
import { buildFlowkoSnippet, getFlowkoNamespace } from "@calcom/features/embed/lib/buildFlowkoSnippet";

vi.mock("../tailwindCss", () => ({
  default: "mockedTailwindCss",
}));

const BOOKER_ORIGIN = "https://booking.example.com";

type LoaderFn = ((...args: unknown[]) => void) & {
  q: unknown[];
  ns: Record<string, (...args: unknown[]) => void>;
  loaded?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CalClass: any;

function calNs(namespace: string) {
  return (window.Cal as unknown as LoaderFn).ns[namespace];
}

function calInstance(namespace: string) {
  const instances = CalClass.instancesByNamespace.get(namespace);
  expect(instances).toHaveLength(1);
  return instances[0];
}

/** The loader snippet from the Embed dialog, minus the <script src> it appends. */
function installLoaderSnippet() {
  (function (C: Window & { Cal?: LoaderFn }, L: string) {
    const p = function (a: { q: unknown[] }, ar: unknown) {
      a.q.push(ar);
    };
    C.Cal =
      C.Cal ||
      (function () {
        const cal = C.Cal as LoaderFn;
        // eslint-disable-next-line prefer-rest-params
        const ar = arguments;
        if (!cal.loaded) {
          cal.ns = {};
          cal.q = cal.q || [];
          cal.loaded = true;
        }
        if (ar[0] === L) {
          const api = function () {
            // eslint-disable-next-line prefer-rest-params
            p(api as unknown as LoaderFn, arguments);
          } as unknown as LoaderFn;
          const namespace = ar[1];
          api.q = api.q || [];
          if (typeof namespace === "string") {
            cal.ns[namespace] = cal.ns[namespace] || api;
            p(cal.ns[namespace] as unknown as LoaderFn, ar);
            p(cal, ["initNamespace", namespace]);
          } else p(cal, ar);
          return;
        }
        p(cal, ar);
      } as unknown as LoaderFn);
  })(window as Window & { Cal?: LoaderFn }, "init");
}

function makeInlineEmbed(namespace: string, calLink = "flowko-test/ogled") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  calNs(namespace)("inline", { elementOrSelector: container, calLink });
  const iframe = container.querySelector("iframe");
  if (!iframe) throw new Error("inline embed rendered no iframe");
  return iframe;
}

function calMessage(namespace: string, type: string, data: Record<string, unknown> = {}) {
  return {
    originator: "CAL",
    type,
    namespace,
    fullType: `CAL:${namespace}:${type}`,
    data,
  };
}

/** Dispatches a message like the browser does and returns the errors the listeners threw. */
function postToHost({
  data,
  origin,
  source,
}: {
  data: unknown;
  origin: string;
  source: MessageEventSource | null;
}) {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => {
    errors.push(e.error);
    e.preventDefault();
  };
  window.addEventListener("error", onError);
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
  window.removeEventListener("error", onError);
  return errors;
}

/**
 * Clicks like a visitor. `defaultPrevented` is read on window, after embed.js's document listener
 * has run; the click is then cancelled so that jsdom doesn't try to navigate (it can't).
 */
function click(el: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, ...init });
  let defaultPrevented: boolean | null = null;
  const afterEmbedJs = (e: Event) => {
    defaultPrevented = e.defaultPrevented;
    e.preventDefault();
  };
  window.addEventListener("click", afterEmbedJs);
  el.dispatchEvent(event);
  window.removeEventListener("click", afterEmbedJs);
  if (defaultPrevented === null) throw new Error("the click did not bubble to window");
  return { defaultPrevented: defaultPrevented as boolean };
}

function modalBoxes() {
  return Array.from(document.querySelectorAll("cal-modal-box"));
}

beforeAll(async () => {
  vi.stubEnv("EMBED_PUBLIC_WEBAPP_URL", BOOKER_ORIGIN);
  installLoaderSnippet();
  const Cal = window.Cal as unknown as LoaderFn;
  for (const namespace of ["ns1", "ns2", "clicks", "lang", "fb"]) {
    Cal("init", namespace, { origin: BOOKER_ORIGIN });
  }
  CalClass = (await import("../embed")).Cal;
});

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("U13-15: the host page accepts messages only from its own embed iframes", () => {
  it("fires the namespace's event for a message from its iframe on the booking origin", () => {
    const iframe = makeInlineEmbed("ns1");
    const callback = vi.fn();
    calNs("ns1")("on", { action: "bookingSuccessfulV2", callback });

    const errors = postToHost({
      data: calMessage("ns1", "bookingSuccessfulV2", { status: "ACCEPTED" }),
      origin: BOOKER_ORIGIN,
      source: iframe.contentWindow,
    });

    expect(errors).toEqual([]);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].detail.data).toEqual({ status: "ACCEPTED" });
    calNs("ns1")("off", { action: "bookingSuccessfulV2", callback });
  });

  it("ignores a message from the embed's iframe when its origin is not the booking origin", () => {
    const iframe = makeInlineEmbed("ns1");
    const callback = vi.fn();
    calNs("ns1")("on", { action: "bookingSuccessfulV2", callback });

    for (const origin of [
      "https://attacker.example",
      "https://booking.example.com.attacker.example",
      "http://booking.example.com",
      "null",
      "",
    ]) {
      expect(postToHost({ data: calMessage("ns1", "bookingSuccessfulV2"), origin, source: iframe.contentWindow })).toEqual(
        []
      );
    }

    expect(callback).not.toHaveBeenCalled();
    calNs("ns1")("off", { action: "bookingSuccessfulV2", callback });
  });

  it("ignores a message on the booking origin that another frame, the page itself or no window sent", () => {
    makeInlineEmbed("ns1");
    const foreignFrame = document.createElement("iframe");
    document.body.appendChild(foreignFrame);
    const callback = vi.fn();
    calNs("ns1")("on", { action: "bookingSuccessfulV2", callback });

    for (const source of [foreignFrame.contentWindow, window, null]) {
      expect(postToHost({ data: calMessage("ns1", "bookingSuccessfulV2"), origin: BOOKER_ORIGIN, source })).toEqual(
        []
      );
    }

    expect(callback).not.toHaveBeenCalled();
    calNs("ns1")("off", { action: "bookingSuccessfulV2", callback });
  });

  it("can't resize or close an embed from a foreign frame", () => {
    const iframe = makeInlineEmbed("ns1");
    const foreignFrame = document.createElement("iframe");
    document.body.appendChild(foreignFrame);
    iframe.style.height = "100px";

    postToHost({
      data: calMessage("ns1", "__dimensionChanged", { iframeHeight: 9999 }),
      origin: BOOKER_ORIGIN,
      source: foreignFrame.contentWindow,
    });
    expect(iframe.style.height).toBe("100px");

    postToHost({
      data: calMessage("ns1", "__dimensionChanged", { iframeHeight: 640 }),
      origin: BOOKER_ORIGIN,
      source: iframe.contentWindow,
    });
    expect(iframe.style.height).toBe("640px");
  });

  it("keeps namespaces apart: one embed's iframe can't fire another namespace's events", () => {
    const iframe1 = makeInlineEmbed("ns1");
    const iframe2 = makeInlineEmbed("ns2");
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    calNs("ns1")("on", { action: "linkReady", callback: callback1 });
    calNs("ns2")("on", { action: "linkReady", callback: callback2 });

    postToHost({ data: calMessage("ns2", "linkReady"), origin: BOOKER_ORIGIN, source: iframe1.contentWindow });
    expect(callback2).not.toHaveBeenCalled();

    postToHost({ data: calMessage("ns1", "linkReady"), origin: BOOKER_ORIGIN, source: iframe1.contentWindow });
    postToHost({ data: calMessage("ns2", "linkReady"), origin: BOOKER_ORIGIN, source: iframe2.contentWindow });
    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);

    calNs("ns1")("off", { action: "linkReady", callback: callback1 });
    calNs("ns2")("off", { action: "linkReady", callback: callback2 });
  });

  it("does not throw for null, string, non-CAL or unknown-namespace messages", () => {
    const iframe = makeInlineEmbed("ns1");
    for (const data of [
      null,
      undefined,
      "hello",
      42,
      { fullType: 42 },
      { mode: "cal:preview", type: "instruction" },
      calMessage("no-such-namespace", "linkReady"),
    ]) {
      expect(postToHost({ data, origin: BOOKER_ORIGIN, source: iframe.contentWindow })).toEqual([]);
    }
  });

  it("marks the iframe ready on __iframeReady from its own iframe only", () => {
    const iframe = makeInlineEmbed("ns1");
    const cal = calInstance("ns1");
    const foreignFrame = document.createElement("iframe");
    document.body.appendChild(foreignFrame);
    expect(cal.iframeReady).toBe(false);

    postToHost({
      data: calMessage("ns1", "__iframeReady", { isPrerendering: false }),
      origin: BOOKER_ORIGIN,
      source: foreignFrame.contentWindow,
    });
    expect(cal.iframeReady).toBe(false);

    const postMessage = vi.spyOn(iframe.contentWindow as Window, "postMessage").mockImplementation(() => undefined);
    postToHost({
      data: calMessage("ns1", "__iframeReady", { isPrerendering: false }),
      origin: BOOKER_ORIGIN,
      source: iframe.contentWindow,
    });
    expect(cal.iframeReady).toBe(true);
    // The reply goes to the booking origin, never "*"
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ originator: "CAL", method: "parentKnowsIframeReady" }),
      BOOKER_ORIGIN
    );
  });

  it("posts instructions (the prefill included) to the booking origin instead of '*'", () => {
    const iframe = makeInlineEmbed("ns1");
    const cal = calInstance("ns1");
    const postMessage = vi.spyOn(iframe.contentWindow as Window, "postMessage").mockImplementation(() => undefined);
    cal.iframeReady = true;

    cal.connect({ config: { name: "Ana", email: "ana@example.com" }, params: {} });
    calNs("ns1")("ui", { theme: "light" });

    expect(postMessage).toHaveBeenCalledTimes(2);
    for (const call of postMessage.mock.calls) {
      expect(call[1]).toBe(BOOKER_ORIGIN);
    }
    expect(postMessage.mock.calls[0][0]).toEqual(expect.objectContaining({ method: "connect" }));
  });

  it("follows an embed's own calOrigin", () => {
    const cal = calInstance("ns2");
    const iframe = cal.createIframe({ calLink: "flowko-test/ogled", calOrigin: "https://other-booking.example.net" });
    document.body.appendChild(iframe);
    const postMessage = vi.spyOn(iframe.contentWindow as Window, "postMessage").mockImplementation(() => undefined);
    const callback = vi.fn();
    calNs("ns2")("on", { action: "linkReady", callback });

    postToHost({ data: calMessage("ns2", "linkReady"), origin: BOOKER_ORIGIN, source: iframe.contentWindow });
    expect(callback).not.toHaveBeenCalled();
    postToHost({
      data: calMessage("ns2", "linkReady"),
      origin: "https://other-booking.example.net",
      source: iframe.contentWindow,
    });
    expect(callback).toHaveBeenCalledTimes(1);

    cal.iframeReady = true;
    cal.doInIframe({ method: "ui", arg: {} });
    expect(postMessage).toHaveBeenCalledWith(expect.anything(), "https://other-booking.example.net");
    calNs("ns2")("off", { action: "linkReady", callback });
  });

  it("floating button: the modal it opens loads and closes through its own iframe's messages", () => {
    calNs("fb")("floatingButton", { calLink: "flowko-test/ogled" });
    const button = document.querySelector("cal-floating-button");
    expect(button).toBeTruthy();
    click(button as Element);

    const [modal] = modalBoxes();
    const iframe = modal.querySelector("iframe") as HTMLIFrameElement;
    expect(new URL(iframe.src).origin).toBe(BOOKER_ORIGIN);
    expect(modal.getAttribute("state")).toBe("loading");

    postToHost({ data: calMessage("fb", "linkReady"), origin: "https://attacker.example", source: iframe.contentWindow });
    expect(modal.getAttribute("state")).toBe("loading");

    postToHost({ data: calMessage("fb", "linkReady"), origin: BOOKER_ORIGIN, source: iframe.contentWindow });
    expect(modal.getAttribute("state")).toBe("loaded");

    postToHost({ data: calMessage("fb", "__closeIframe"), origin: BOOKER_ORIGIN, source: window });
    expect(modal.getAttribute("state")).toBe("loaded");
    postToHost({ data: calMessage("fb", "__closeIframe"), origin: BOOKER_ORIGIN, source: iframe.contentWindow });
    expect(modal.getAttribute("state")).toBe("closed");
  });

  it("prerendered modal: its iframe's __iframeReady is accepted", () => {
    calNs("ns2")("prerender", { calLink: "flowko-test/prerender", type: "modal" });
    const [modal] = modalBoxes();
    expect(modal.getAttribute("state")).toBe("prerendering");
    const iframe = modal.querySelector("iframe") as HTMLIFrameElement;
    vi.spyOn(iframe.contentWindow as Window, "postMessage").mockImplementation(() => undefined);

    postToHost({
      data: calMessage("ns2", "__iframeReady", { isPrerendering: true }),
      origin: BOOKER_ORIGIN,
      source: iframe.contentWindow,
    });
    expect(calInstance("ns2").iframeReady).toBe(true);
  });

  it("two instances of one namespace: each one's iframe reaches the host", () => {
    const first = new CalClass("dup-ns", []);
    const second = new CalClass("dup-ns", []);
    const iframes = [first, second].map((cal) => {
      const iframe = cal.createIframe({ calLink: "flowko-test/ogled", calOrigin: BOOKER_ORIGIN });
      document.body.appendChild(iframe);
      return iframe;
    });
    const callback = vi.fn();
    window.addEventListener("CAL:dup-ns:linkReady", callback);

    for (const iframe of iframes) {
      postToHost({ data: calMessage("dup-ns", "linkReady"), origin: BOOKER_ORIGIN, source: iframe.contentWindow });
    }
    const foreignFrame = document.createElement("iframe");
    document.body.appendChild(foreignFrame);
    postToHost({ data: calMessage("dup-ns", "linkReady"), origin: BOOKER_ORIGIN, source: foreignFrame.contentWindow });

    expect(callback).toHaveBeenCalledTimes(2);
    window.removeEventListener("CAL:dup-ns:linkReady", callback);
  });

  it("an inline embed and a modal in one namespace: both iframes still reach the host", () => {
    const inlineIframe = makeInlineEmbed("ns1");
    const link = document.createElement("button");
    link.setAttribute("data-cal-link", "flowko-test/ogled");
    link.setAttribute("data-cal-namespace", "ns1");
    document.body.appendChild(link);
    click(link);
    const modalIframe = modalBoxes()[0].querySelector("iframe") as HTMLIFrameElement;
    expect(calInstance("ns1").iframe).toBe(modalIframe);

    const callback = vi.fn();
    calNs("ns1")("on", { action: "bookingSuccessfulV2", callback });
    postToHost({
      data: calMessage("ns1", "bookingSuccessfulV2"),
      origin: BOOKER_ORIGIN,
      source: inlineIframe.contentWindow,
    });
    postToHost({
      data: calMessage("ns1", "bookingSuccessfulV2"),
      origin: BOOKER_ORIGIN,
      source: modalIframe.contentWindow,
    });
    expect(callback).toHaveBeenCalledTimes(2);
    calNs("ns1")("off", { action: "bookingSuccessfulV2", callback });
  });
});

describe("U13-13: a data-cal-link on a link opens the modal instead of following the link", () => {
  function appendHtml(html: string) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    return wrapper;
  }

  function expectOneModalFor(calLink: string) {
    const boxes = modalBoxes();
    expect(boxes).toHaveLength(1);
    const iframe = boxes[0].querySelector("iframe") as HTMLIFrameElement;
    expect(new URL(iframe.src).pathname).toBe(`/${calLink}/embed`);
  }

  it("<a href data-cal-link>: modal queued and the navigation prevented", () => {
    const wrapper = appendHtml(
      `<a href="/x" data-cal-link="flowko-test/ogled" data-cal-namespace="clicks">Rezervirajte termin</a>`
    );
    const event = click(wrapper.querySelector("a") as Element);

    expect(event.defaultPrevented).toBe(true);
    expectOneModalFor("flowko-test/ogled");
  });

  it("the click-link variant: an absolute booking-page href opens the modal in place", () => {
    const wrapper = appendHtml(
      `<a href="${BOOKER_ORIGIN}/flowko-test/ogled" target="_blank" data-cal-link="flowko-test/ogled" data-cal-namespace="clicks"><span>Rezervirajte</span> <strong>termin</strong></a>`
    );
    const event = click(wrapper.querySelector("strong") as Element);

    expect(event.defaultPrevented).toBe(true);
    expectOneModalFor("flowko-test/ogled");
  });

  it("a data-cal-link element inside an <a href>", () => {
    const wrapper = appendHtml(
      `<a href="/x"><span data-cal-link="flowko-test/ogled" data-cal-namespace="clicks">Rezervirajte termin</span></a>`
    );
    const event = click(wrapper.querySelector("span") as Element);

    expect(event.defaultPrevented).toBe(true);
    expectOneModalFor("flowko-test/ogled");
  });

  it("an <a href> inside a data-cal-link element", () => {
    const wrapper = appendHtml(
      `<div data-cal-link="flowko-test/ogled" data-cal-namespace="clicks"><a href="/x">Rezervirajte termin</a></div>`
    );
    const event = click(wrapper.querySelector("a") as Element);

    expect(event.defaultPrevented).toBe(true);
    expectOneModalFor("flowko-test/ogled");
  });

  it("a <button data-cal-link> opens the modal and its default is left alone", () => {
    const wrapper = appendHtml(
      `<button type="button" data-cal-link="flowko-test/ogled" data-cal-namespace="clicks">Rezervirajte termin</button>`
    );
    const event = click(wrapper.querySelector("button") as Element);

    expect(event.defaultPrevented).toBe(false);
    expectOneModalFor("flowko-test/ogled");
  });

  it("an <a data-cal-link> without href has nothing to prevent", () => {
    const wrapper = appendHtml(`<a data-cal-link="flowko-test/ogled" data-cal-namespace="clicks">Rezervirajte termin</a>`);
    const event = click(wrapper.querySelector("a") as Element);

    expect(event.defaultPrevented).toBe(false);
    expectOneModalFor("flowko-test/ogled");
  });

  it("a click on an SVG icon inside the element opens the modal", () => {
    const wrapper = appendHtml(
      `<a href="/x" data-cal-link="flowko-test/ogled" data-cal-namespace="clicks"><svg><path d="M0 0"></path></svg> Rezervirajte termin</a>`
    );
    const path = wrapper.querySelector("path") as Element;
    expect(path instanceof HTMLElement).toBe(false);
    const event = click(path);

    expect(event.defaultPrevented).toBe(true);
    expectOneModalFor("flowko-test/ogled");
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    "a modifier click (%o) on the link follows it and opens no modal",
    (init) => {
      const wrapper = appendHtml(
        `<a href="/x" data-cal-link="flowko-test/ogled" data-cal-namespace="clicks">Rezervirajte termin</a>`
      );
      const event = click(wrapper.querySelector("a") as Element, init);

      expect(event.defaultPrevented).toBe(false);
      expect(modalBoxes()).toHaveLength(0);
    }
  );

  it("a link inside a web component's shadow root is found too", () => {
    const host = document.createElement("div");
    host.setAttribute("data-cal-link", "flowko-test/ogled");
    host.setAttribute("data-cal-namespace", "clicks");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<a href="/x"><span>Rezervirajte termin</span></a>`;
    document.body.appendChild(host);

    const event = click(shadow.querySelector("span") as Element);

    expect(event.defaultPrevented).toBe(true);
    expectOneModalFor("flowko-test/ogled");
  });

  it("an ordinary link elsewhere on the page is left alone", () => {
    const wrapper = appendHtml(`<a href="/kontakt">Kontakt</a>`);
    const event = click(wrapper.querySelector("a") as Element);

    expect(event.defaultPrevented).toBe(false);
    expect(modalBoxes()).toHaveLength(0);
  });
});

// Flowko (U13 fix pass): the click-link script (plan §3.4, "Vaš gumb") and embed.js on one page. Webflow
// users may add data-cal-link attributes (guide §7.5) to the very link the script matches; both the script's
// capture listener and embed.js's document listener opened a modal for it.
describe("U13 fix pass: the click-link script and a data-cal-link on the same link", () => {
  const CAL_LINK = "flowko-test/dvojni";
  // Flowko P0: Webflow's data-cal-namespace must name the click-link code's namespace (guide §7.5)
  const NAMESPACE = getFlowkoNamespace("click-link", "dvojni");
  let removeClickLinkListener = () => undefined as void;

  beforeAll(() => {
    const html = buildFlowkoSnippet({
      type: "click-link",
      calLink: CAL_LINK,
      namespace: "dvojni",
      origin: BOOKER_ORIGIN,
      embedLibUrl: `${BOOKER_ORIGIN}/embed/embed.js`,
    });
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error("the click-link snippet has no script");
    const addEventListener = vi.spyOn(document, "addEventListener");
    // Runs as the pasted <script> would; the loader finds window.Cal already there, as on a page where
    // embed.js has loaded
    new Function(script)();
    const call = addEventListener.mock.calls.find(([type]) => type === "click");
    addEventListener.mockRestore();
    if (!call) throw new Error("the click-link script added no click listener");
    const [type, listener, options] = call;
    removeClickLinkListener = () => document.removeEventListener(type, listener, options);
  });

  afterAll(() => removeClickLinkListener());

  function appendHtml(html: string) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    return wrapper;
  }

  function expectOneModal() {
    const boxes = modalBoxes();
    expect(boxes).toHaveLength(1);
    const iframe = boxes[0].querySelector("iframe") as HTMLIFrameElement;
    expect(new URL(iframe.src).pathname).toBe(`/${CAL_LINK}/embed`);
  }

  const linkWithAttributes = (inner: string) =>
    `<a href="${BOOKER_ORIGIN}/${CAL_LINK}" data-cal-link="${CAL_LINK}" data-cal-namespace="${NAMESPACE}">` +
    `${inner}</a>`;

  it("<a href> to the booking page with data-cal-link opens exactly one modal", () => {
    const wrapper = appendHtml(linkWithAttributes("Rezervirajte"));
    const event = click(wrapper.querySelector("a") as Element);

    expect(event.defaultPrevented).toBe(true);
    expectOneModal();
  });

  it("a click on text inside such a link opens exactly one modal too", () => {
    const wrapper = appendHtml(linkWithAttributes("<span>Rezervirajte</span>"));
    const event = click(wrapper.querySelector("span") as Element);

    expect(event.defaultPrevented).toBe(true);
    expectOneModal();
  });

  it("a plain <a href> to the booking page still opens one modal through the script", () => {
    const wrapper = appendHtml(`<a href="${BOOKER_ORIGIN}/${CAL_LINK}">Rezervirajte</a>`);
    const event = click(wrapper.querySelector("a") as Element);

    expect(event.defaultPrevented).toBe(true);
    expectOneModal();
  });
});

describe("U13-14: embed.js speaks the host page's language", () => {
  function openModal() {
    const button = document.createElement("button");
    button.setAttribute("data-cal-link", "flowko-test/ogled");
    button.setAttribute("data-cal-namespace", "lang");
    document.body.appendChild(button);
    click(button);
    const boxes = modalBoxes();
    return boxes[boxes.length - 1] as HTMLElement;
  }

  it.each([
    { lang: null, expected: "sl" },
    { lang: "sl", expected: "sl" },
    { lang: "sl-SI", expected: "sl" },
    { lang: "en", expected: "en" },
    { lang: "en-GB", expected: "en" },
    { lang: "de-AT", expected: "en" },
  ])("<html lang=$lang>: $expected texts", ({ lang, expected }) => {
    if (lang) document.documentElement.lang = lang;
    const sl = expected === "sl";

    calNs("lang")("floatingButton", { calLink: "flowko-test/ogled" });
    const floatingButton = document.querySelector("cal-floating-button") as HTMLElement;
    expect(floatingButton.dataset.buttonText).toBe(sl ? "Rezervirajte termin" : "Book an appointment");
    expect(floatingButton.shadowRoot?.querySelector("#button")?.textContent).toBe(
      sl ? "Rezervirajte termin" : "Book an appointment"
    );

    const modal = openModal();
    const iframe = modal.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe.title).toBe(sl ? "Rezervacija termina" : "Appointment booking");
    expect(modal.shadowRoot?.querySelector(".close")?.getAttribute("aria-label")).toBe(sl ? "Zapri" : "Close");
    expect(modal.shadowRoot?.querySelector('[data-testid="decrementMonth"]')?.getAttribute("aria-label")).toBe(
      sl ? "Prikaži prejšnji mesec" : "View previous month"
    );

    modal.setAttribute("data-error-code", "404");
    modal.setAttribute("state", "failed");
    // ModalBox sets innerText, which jsdom (no layout) stores as given
    expect((modal.shadowRoot?.querySelector("#message") as HTMLElement).innerText).toBe(
      sl ? "Koda napake: 404. Ta stran za rezervacijo ne obstaja." : "Error code: 404. This booking page does not exist."
    );
  });

  it("an explicit buttonText still wins", () => {
    calNs("lang")("floatingButton", { calLink: "flowko-test/ogled", buttonText: "Naročite se" });
    const floatingButton = document.querySelector("cal-floating-button") as HTMLElement;
    expect(floatingButton.dataset.buttonText).toBe("Naročite se");
  });

  it("the inline embed's error text", () => {
    document.documentElement.lang = "sl-SI";
    const iframe = makeInlineEmbed("lang");
    const inline = iframe.closest("cal-inline") as HTMLElement;
    expect(inline.shadowRoot?.querySelector("#error")?.textContent?.trim()).toBe("Nekaj je šlo narobe.");

    inline.setAttribute("data-error-code", "500");
    inline.setAttribute("loading", "failed");
    expect((inline.shadowRoot?.querySelector("#error") as HTMLElement).innerText).toBe(
      "Koda napake: 500. Nekaj je šlo narobe."
    );
  });
});

// Flowko C1: the floating button sits under cookie-consent banners (z-index 998, inline on the shadow <button>)
describe("C1: the floating button's layer on a client's page", () => {
  function shadowButton(el: Element | null): HTMLButtonElement {
    const button = el?.shadowRoot?.querySelector("button");
    if (!button) throw new Error("cal-floating-button rendered no <button>");
    return button;
  }

  it("after floatingButton, and after its position changes to bottom-left", () => {
    calNs("fb")("floatingButton", { calLink: "flowko-test/ogled", attributes: { id: "c1-floating" } });
    const button = shadowButton(document.querySelector("cal-floating-button"));
    expect(button.style.zIndex).toBe("998");
    expect(button.classList.contains("right-4")).toBe(true);

    // The same element again: floatingButton updates its dataset, FloatingButton rewrites the class list
    calNs("fb")("floatingButton", {
      calLink: "flowko-test/ogled",
      attributes: { id: "c1-floating" },
      buttonPosition: "bottom-left",
    });
    expect(document.querySelectorAll("cal-floating-button")).toHaveLength(1);
    expect(button.classList.contains("left-4")).toBe(true);
    expect(button.classList.contains("right-4")).toBe(false);
    expect(button.style.zIndex).toBe("998");
  });

  it("created at bottom-left", () => {
    calNs("fb")("floatingButton", { calLink: "flowko-test/ogled", buttonPosition: "bottom-left" });
    const button = shadowButton(document.querySelector("cal-floating-button"));
    expect(button.classList.contains("left-4")).toBe(true);
    expect(button.classList.contains("right-4")).toBe(false);
    expect(button.style.zIndex).toBe("998");
  });
});

// Flowko P0: the calendar and a pop-up of the same event type on one page, pasted exactly as the builder writes
// them. Cal keeps one `iframe` per namespace (the newest), so while every type used the slug as its namespace,
// the calendar's resize messages went to the pop-up's iframe once it had opened (booking.flowko.si, 2026-09-28:
// the window took the calendar's 660 px and the calendar frame stayed at 490 px).
describe("P0: a calendar and a pop-up of the same event type on one page", () => {
  const CAL_LINK = "flowko-test/kombinacija";
  const undo: (() => void)[] = [];

  afterEach(() => {
    for (const fn of undo.splice(0)) fn();
  });

  const snippet = (type: FlowkoSnippetType) =>
    buildFlowkoSnippet({
      type,
      calLink: CAL_LINK,
      origin: BOOKER_ORIGIN,
      embedLibUrl: `${BOOKER_ORIGIN}/embed/embed.js`,
    });

  /** Pastes the builder's HTML as a page would: its elements into the body, then its script runs. */
  function paste(html: string) {
    const wrapper = document.createElement("div");
    // A <script> added through innerHTML does not run, so it is run below, as the browser would
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    const addEventListener = vi.spyOn(document, "addEventListener");
    for (const script of Array.from(wrapper.querySelectorAll("script"))) {
      new Function(script.textContent ?? "")();
    }
    // The click-link script listens on the document; later tests must not see it
    for (const [type, listener, options] of addEventListener.mock.calls) {
      undo.push(() => document.removeEventListener(type, listener, options));
    }
    addEventListener.mockRestore();
  }

  /** The namespace the booking page in this iframe puts in its messages (embed-iframe reads ?embed=). */
  const namespaceOf = (iframe: HTMLIFrameElement) => new URL(iframe.src).searchParams.get("embed") as string;

  /** The booking page in this iframe reports its content height, as embed-iframe does after every render. */
  const reportHeight = (iframe: HTMLIFrameElement, iframeHeight: number) =>
    postToHost({
      data: calMessage(namespaceOf(iframe), "__dimensionChanged", { iframeHeight }),
      origin: BOOKER_ORIGIN,
      source: iframe.contentWindow,
    });

  const openers: Record<Exclude<FlowkoSnippetType, "inline">, () => void> = {
    "floating-popup": () => click(document.querySelector("cal-floating-button") as Element),
    "element-click": () => click(document.querySelector("button[data-cal-link]") as Element),
    "click-link": () => {
      const link = document.createElement("a");
      link.href = `${BOOKER_ORIGIN}/${CAL_LINK}`;
      link.textContent = "Rezervirajte";
      document.body.appendChild(link);
      click(link);
    },
  };

  const MODAL_NAMESPACE: Record<Exclude<FlowkoSnippetType, "inline">, string> = {
    "floating-popup": "kombinacija_lebdeci",
    "element-click": "kombinacija_gumb",
    "click-link": "kombinacija_povezava",
  };

  it.each(["floating-popup", "element-click", "click-link"] as const)(
    "calendar + %s: each iframe follows its own booking page's height",
    (type) => {
      paste(snippet("inline"));
      paste(snippet(type));
      const inlineIframe = document.querySelector("cal-inline iframe") as HTMLIFrameElement;
      openers[type]();
      const boxes = modalBoxes();
      expect(boxes).toHaveLength(1);
      const modalIframe = boxes[0].querySelector("iframe") as HTMLIFrameElement;

      const errorsModal = reportHeight(modalIframe, 490);
      const errorsInline = reportHeight(inlineIframe, 660);

      expect(inlineIframe.style.height).toBe("660px");
      expect(modalIframe.style.height).toBe("490px");
      expect(namespaceOf(inlineIframe)).toBe("kombinacija");
      expect(namespaceOf(modalIframe)).toBe(MODAL_NAMESPACE[type]);
      expect([...errorsModal, ...errorsInline]).toEqual([]);
    }
  );
});
