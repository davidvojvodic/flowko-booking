import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { DEFAULT_LIGHT_BRAND_COLOR } from "@calcom/lib/constants";
import slugify from "@calcom/lib/slugify";

import { buildCssVarsPerTheme, getPinnedBrandColors } from "./buildCssVarsPerTheme";
import type { BuildFlowkoSnippetInput, FlowkoSnippetLang, FlowkoSnippetType } from "./buildFlowkoSnippet";
import {
  buildFlowkoSnippet,
  FLOWKO_BOOK_BUTTON_TEXT,
  FLOWKO_DEFAULT_BUTTON_COLOR,
  FLOWKO_NAMESPACE_SUFFIX,
  getFlowkoNamespace,
} from "./buildFlowkoSnippet";
import { getApiNameWithNamespace } from "./getApiName";

// Flowko U13-01/02/06/07b: the embed code a client pastes. Golden files pin the exact output; run with
// UPDATE_GOLDENS=1 to rewrite them after an intended change, and review the diff.

const GOLDEN_DIR = path.join(__dirname, "__goldens__");
const ORIGIN = "https://booking.flowko.si";
const EMBED_LIB_URL = "https://booking.flowko.si/embed/embed.js";
const TYPES: FlowkoSnippetType[] = ["inline", "floating-popup", "element-click", "click-link"];
const LANGS: FlowkoSnippetLang[] = ["sl", "en"];

const base = {
  calLink: "flowko-test/ogled",
  namespace: "ogled",
  origin: ORIGIN,
  embedLibUrl: EMBED_LIB_URL,
  buttonColor: "#0F766E",
} satisfies Omit<BuildFlowkoSnippetInput, "type">;

function golden(name: string, output: string) {
  const file = path.join(GOLDEN_DIR, `${name}.html`);
  if (process.env.UPDATE_GOLDENS === "1") writeFileSync(file, `${output}\n`);
  expect(`${output}\n`).toBe(readFileSync(file, "utf8"));
}

// The loader lines: from the <script> tag through the end of the Cal("init", …) statement (one line, or two
// for a long slug).
function loaderLines(output: string) {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => line.startsWith("<script"));
  let end = lines.findIndex((line) => line.startsWith('  Cal("init"'));
  while (!lines[end].endsWith("});")) end++;
  return lines.slice(start, end + 1);
}

// Long Slovenian slugs (the init line wraps past 31 characters): 49 characters, and 73, the longest that keeps
// every loader line at 90 or less on booking.flowko.si.
const LONG_SLUG = "brezplacni-uvodni-posvet-za-nove-stranke-30-minut";
const LONGEST_SLUG = "prvi-pregled-in-posvet-za-nove-paciente-z-napotnico-osebnega-zdravnika-30";

// Plan §3.3 LOADER, verbatim; Flowko P0: the init line names the type's own namespace.
const planLoader = (namespace: string) => `<script type="text/javascript" data-cfasync="false" nowprocket>
  (function (C, A, L) {
    let p = function (a, ar) { a.q.push(ar); };
    let d = C.document;
    C.Cal = C.Cal || function () {
      let cal = C.Cal; let ar = arguments;
      if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || [];
        d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; }
      if (ar[0] === L) {
        const api = function () { p(api, arguments); };
        const namespace = ar[1]; api.q = api.q || [];
        if (typeof namespace === "string") { cal.ns[namespace] = cal.ns[namespace] || api;
          p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]); }
        else p(cal, ar);
        return;
      }
      p(cal, ar);
    };
  })(window, "https://booking.flowko.si/embed/embed.js", "init");
  Cal("init", "${namespace}", { origin: "https://booking.flowko.si" });`;

// Plan §3.3 and §3.4, verbatim (flowko-test/ogled, brand #0F766E). Flowko (U13 fix pass): §3.4 gained the
// data-cal-link line; the plan is updated to match. Flowko P0 (plan 2026-09-28-p0-builder-namespaces): the
// calendar keeps "ogled", the floating button, our button and the client's own link use "ogled_lebdeci",
// "ogled_gumb" and "ogled_povezava".
const PLAN_OUTPUT: Record<FlowkoSnippetType, string> = {
  inline: `<!-- Flowko Rezervacije: koledar na strani (začetek) -->
<div id="flowko-rezervacije-ogled" style="width:100%;height:100%;overflow:scroll"></div>
${planLoader("ogled")}
  Cal.ns.ogled("inline", {
    elementOrSelector: "#flowko-rezervacije-ogled",
    config: { "layout": "month_view", "useSlotsViewOnSmallScreen": "true", "theme": "light" },
    calLink: "flowko-test/ogled",
  });
  Cal.ns.ogled("ui", { "theme": "light", "hideEventTypeDetails": false, "layout": "month_view" });
</script>
<!-- Flowko Rezervacije: koledar na strani (konec) -->`,
  "floating-popup": `<!-- Flowko Rezervacije: lebdeči gumb (začetek) -->
${planLoader("ogled_lebdeci")}
  Cal.ns.ogled_lebdeci("floatingButton", {
    "calLink": "flowko-test/ogled",
    "config": { "layout": "month_view", "useSlotsViewOnSmallScreen": "true", "theme": "light" },
    "buttonText": "Rezervirajte termin",
    "buttonColor": "#0F766E",
    "buttonTextColor": "#FFFFFF",
    "buttonPosition": "bottom-right"
  });
  Cal.ns.ogled_lebdeci("ui", { "theme": "light", "hideEventTypeDetails": false, "layout": "month_view" });
</script>
<!-- Flowko Rezervacije: lebdeči gumb (konec) -->`,
  "element-click": `<!-- Flowko Rezervacije: gumb, ki odpre okno za rezervacijo (začetek) -->
<button type="button" data-cal-link="flowko-test/ogled" data-cal-namespace="ogled_gumb"
  data-cal-config='{"layout":"month_view","theme":"light"}'>Rezervirajte termin</button>
${planLoader("ogled_gumb")}
  Cal.ns.ogled_gumb("ui", { "theme": "light", "hideEventTypeDetails": false, "layout": "month_view" });
</script>
<!-- Flowko Rezervacije: gumb, ki odpre okno za rezervacijo (konec) -->`,
  "click-link": `<!-- Flowko Rezervacije: vaši gumbi odprejo okno za rezervacijo (začetek) -->
${planLoader("ogled_povezava")}
  Cal.ns.ogled_povezava("ui", { "theme": "light", "hideEventTypeDetails": false, "layout": "month_view" });
  document.addEventListener("click", function (e) {
    var a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target.closest("[data-cal-link]")) return;
    var u; try { u = new URL(a.href); } catch (_) { return; }
    if (u.origin !== "https://booking.flowko.si" || u.pathname.replace(/\\/$/, "") !== "/flowko-test/ogled") return;
    e.preventDefault();
    Cal.ns.ogled_povezava("modal", { calLink: "flowko-test/ogled", config: { "layout": "month_view", "theme": "light" } });
  }, true);
</script>
<!-- Flowko Rezervacije: vaši gumbi odprejo okno za rezervacijo (konec) -->`,
};

// Upstream's one-line loader (EmbedTabs.tsx before U13), for the equivalence check.
const UPSTREAM_LOADER = `(function (C, A, L) { let p = function (a, ar) { a.q.push(ar); }; let d = C.document; C.Cal = C.Cal || function () { let cal = C.Cal; let ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; } if (ar[0] === L) { const api = function () { p(api, arguments); }; const namespace = ar[1]; api.q = api.q || []; if(typeof namespace === "string"){cal.ns[namespace] = cal.ns[namespace] || api;p(cal.ns[namespace], ar);p(cal, ["initNamespace", namespace]);} else p(cal, ar); return;} p(cal, ar); }; })(window, "${EMBED_LIB_URL}", "init");`;

/** Runs the snippet's HTML in a page (embed.js itself is not fetched). */
function runInPage(html: string) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`, {
    runScripts: "dangerously",
    url: "https://client.example.com/",
  });
  return dom.window as unknown as Window &
    typeof globalThis & {
      Cal: {
        q: unknown[][];
        ns: Record<string, { q: unknown[][] }>;
        loaded: boolean;
      };
    };
}

const queues = (win: ReturnType<typeof runInPage>) =>
  JSON.parse(
    JSON.stringify({
      q: win.Cal.q.map((args) => Array.from(args)),
      ns: Object.fromEntries(
        Object.entries(win.Cal.ns).map(([ns, api]) => [ns, api.q.map((args) => Array.from(args))])
      ),
      scripts: Array.from(win.document.head.querySelectorAll("script")).map((s) => s.getAttribute("src")),
    })
  );

describe("buildFlowkoSnippet", () => {
  describe("matches plan §3.3/§3.4 verbatim (sl, flowko-test/ogled, brand #0F766E)", () => {
    it.each(TYPES)("%s", (type) => {
      expect(buildFlowkoSnippet({ ...base, type })).toBe(PLAN_OUTPUT[type]);
    });

    it("the loader is the plan's LOADER", () => {
      expect(loaderLines(buildFlowkoSnippet({ ...base, type: "inline" })).join("\n")).toBe(planLoader("ogled"));
    });
  });

  describe("golden files", () => {
    for (const type of TYPES) {
      for (const lang of LANGS) {
        it(`${type} ${lang}`, () => {
          golden(`${type}.${lang}`, buildFlowkoSnippet({ ...base, type, lang }));
        });
      }
    }

    // Q7: the host keeps the profile colour -> no palette; picks another colour -> the full palette.
    it("brand colour = profile colour: no cssVarsPerTheme", () => {
      const pinned = getPinnedBrandColors({
        picked: { brandColor: "#0f766e", darkBrandColor: "#FAFAFA" },
        profile: { brandColor: "#0F766E", darkBrandColor: "#fafafa" },
      });
      expect(pinned).toEqual({ brandColor: null, darkBrandColor: null });
      const output = buildFlowkoSnippet({
        ...base,
        type: "floating-popup",
        cssVarsPerTheme: buildCssVarsPerTheme(pinned),
      });
      expect(output).not.toContain("cssVarsPerTheme");
      expect(output).not.toContain("cal-brand");
      golden("floating-popup.sl.brand-equals-profile", output);
    });

    it("brand colour differs from the profile: the full five-variable palette for that theme", () => {
      const pinned = getPinnedBrandColors({
        picked: { brandColor: "#0F766E", darkBrandColor: "#fafafa" },
        profile: { brandColor: "#292929", darkBrandColor: "#fafafa" },
      });
      expect(pinned).toEqual({ brandColor: "#0F766E", darkBrandColor: null });
      const output = buildFlowkoSnippet({
        ...base,
        type: "floating-popup",
        cssVarsPerTheme: buildCssVarsPerTheme(pinned),
      });
      for (const cssVar of [
        "cal-brand",
        "cal-brand-emphasis",
        "cal-brand-subtle",
        "cal-brand-text",
        "cal-brand-accent",
      ]) {
        expect(output).toContain(`"${cssVar}":`);
      }
      expect(output).not.toContain('"dark"');
      golden("floating-popup.sl.brand-differs", output);
    });

    it("both theme colours differ: a palette per theme", () => {
      const output = buildFlowkoSnippet({
        ...base,
        type: "inline",
        lang: "en",
        cssVarsPerTheme: buildCssVarsPerTheme({ brandColor: "#FFD700", darkBrandColor: "#1E3A8A" }),
      });
      expect(output).toContain('"light": {');
      expect(output).toContain('"dark": {');
      golden("inline.en.brand-differs-both-themes", output);
    });

    it("a long slug puts the init options on their own line", () => {
      const output = buildFlowkoSnippet({
        type: "inline",
        calLink: `vase-podjetje/${LONG_SLUG}`,
        origin: ORIGIN,
        embedLibUrl: EMBED_LIB_URL,
      });
      expect(loaderLines(output).slice(-2)).toEqual([
        `  Cal("init", "${LONG_SLUG}",`,
        '    { origin: "https://booking.flowko.si" });',
      ]);
      expect(output.match(/Cal\("init"/g)).toHaveLength(1);
      // A slug over 73 characters still gives working code; only its init line is longer than 90.
      const longer = buildFlowkoSnippet({
        type: "inline",
        calLink: `vase-podjetje/${LONGEST_SLUG}-x`,
        origin: ORIGIN,
        embedLibUrl: EMBED_LIB_URL,
      });
      expect(loaderLines(longer).filter((line) => line.length > 90)).toEqual([
        `  Cal("init", "${LONGEST_SLUG}-x",`,
      ]);
    });

    // Flowko P0: the bound is on the namespace, so a pop-up code's slug may be as long as 73 minus its suffix
    it("every loader line stays at 90 or less for slugs of up to 73, 65, 68 and 64 characters", () => {
      const maxSlug = TYPES.map((type) => 73 - FLOWKO_NAMESPACE_SUFFIX[type].length);
      expect(maxSlug).toEqual([73, 65, 68, 64]);
      TYPES.forEach((type, i) => {
        const build = (slug: string) =>
          buildFlowkoSnippet({ type, calLink: `vase-podjetje/${slug}`, origin: ORIGIN, embedLibUrl: EMBED_LIB_URL });
        expect(loaderLines(build("a".repeat(maxSlug[i]))).filter((line) => line.length > 90)).toEqual([]);
        expect(loaderLines(build("a".repeat(maxSlug[i] + 1))).filter((line) => line.length > 90)).toHaveLength(1);
      });
    });

    it("hyphenated slug uses bracket notation", () => {
      const output = buildFlowkoSnippet({
        type: "inline",
        calLink: "flowko-test/a-b",
        origin: ORIGIN,
        embedLibUrl: EMBED_LIB_URL,
      });
      expect(output).toContain('Cal.ns["a-b"]("inline", {');
      expect(output).toContain('Cal.ns["a-b"]("ui", {');
      expect(output).toContain('Cal("init", "a-b", { origin: "https://booking.flowko.si" });');
      expect(output).not.toContain("Cal.ns.a-b");
      golden("inline.sl.hyphenated-slug", output);
    });
  });

  describe("every output", () => {
    const matrix: BuildFlowkoSnippetInput[] = [];
    for (const type of TYPES)
      for (const lang of LANGS)
        for (const theme of ["light", "dark", "auto"] as const)
          for (const calLink of [
            "flowko-test/ogled",
            "vase-podjetje/pregled-zob",
            "a/b.c",
            "vase-podjetje/brezplacni-uvodni-posvet-30-minut",
            `vase-podjetje/${LONG_SLUG}`,
            `vase-podjetje/${LONGEST_SLUG}`,
          ])
            matrix.push({ type, lang, theme, calLink, origin: ORIGIN, embedLibUrl: EMBED_LIB_URL });

    it.each(
      matrix.map((input) => [`${input.type} ${input.lang} ${input.theme} ${input.calLink}`, input])
    )("%s", (_name, input) => {
      const output = buildFlowkoSnippet(input);
      expect(output).toContain("https://booking.flowko.si/embed/embed.js");
      expect(output).toContain('origin: "https://booking.flowko.si"');
      expect(output.match(/cal\.com/gi)).toBeNull();
      expect(output).toContain('<script type="text/javascript" data-cfasync="false" nowprocket>');
      expect(output).not.toContain("data-cookieconsent");
      expect(output.startsWith("<!-- Flowko Rezervacije: ")).toBe(true);
      expect(output.endsWith(input.lang === "sl" ? "(konec) -->" : "(end) -->")).toBe(true);
      const loader = loaderLines(output);
      const namespace = getFlowkoNamespace(input.type, input.calLink.split("/").pop() as string);
      expect(loader).toHaveLength(namespace.length > 31 ? 21 : 20);
      // Flowko P0: only the init line grows with the namespace; up to 73 characters every loader line is 90 or
      // less (slugs of up to 73 for the calendar, 64 to 68 for the pop-up types)
      expect(loader.filter((line) => line.length > 90)).toEqual(
        namespace.length > 73 ? [`  Cal("init", "${namespace}",`] : []
      );
      if (input.theme === "auto") expect(output).not.toContain('"theme"');
      else expect(output).toContain(`"theme": "${input.theme}"`);
    });

    it("defaults to the light theme, month view and Slovenian", () => {
      const output = buildFlowkoSnippet({
        type: "inline",
        calLink: "x/y",
        origin: ORIGIN,
        embedLibUrl: EMBED_LIB_URL,
      });
      expect(output).toContain('"theme": "light"');
      expect(output).toContain('"layout": "month_view"');
      expect(output).toContain("(začetek)");
    });
  });

  describe("the loader behaves like upstream's", () => {
    it.each(["ogled", "a-b", LONG_SLUG])("queues the same instructions (namespace %s)", (slug) => {
      const namespace = getFlowkoNamespace("floating-popup", slug);
      const ours = runInPage(
        buildFlowkoSnippet({
          ...base,
          type: "floating-popup",
          calLink: `flowko-test/${slug}`,
          namespace: slug,
        })
      );
      const theirs = runInPage(`<script>${UPSTREAM_LOADER}
Cal("init", ${JSON.stringify(namespace)}, { origin: "${ORIGIN}" });
Cal.ns[${JSON.stringify(namespace)}]("floatingButton", ${JSON.stringify({
        calLink: `flowko-test/${slug}`,
        config: { layout: "month_view", useSlotsViewOnSmallScreen: "true", theme: "light" },
        buttonText: "Rezervirajte termin",
        buttonColor: "#0F766E",
        buttonTextColor: "#FFFFFF",
        buttonPosition: "bottom-right",
      })});
Cal.ns[${JSON.stringify(namespace)}]("ui", { theme: "light", hideEventTypeDetails: false, layout: "month_view" });
</script>`);
      expect(queues(ours)).toEqual(queues(theirs));
      expect(queues(ours).scripts).toEqual([EMBED_LIB_URL]);
      expect(queues(ours).q).toEqual([["initNamespace", namespace]]);
    });

    it("a second snippet on the same page reuses the loader and adds its namespace", () => {
      const win = runInPage(
        [
          buildFlowkoSnippet({ ...base, type: "inline" }),
          buildFlowkoSnippet({
            ...base,
            type: "floating-popup",
            calLink: "flowko-test/posvet",
            namespace: "posvet",
          }),
        ].join("\n")
      );
      expect(queues(win).scripts).toEqual([EMBED_LIB_URL]);
      expect(Object.keys(win.Cal.ns)).toEqual(["ogled", "posvet_lebdeci"]);
      expect(win.document.getElementById("flowko-rezervacije-ogled")).not.toBeNull();
    });

    // Flowko P0: embed.js keeps one iframe per namespace, so the four codes of one event type must not share one
    it("all four codes of one event type on one page: one embed.js, four namespaces", () => {
      const win = runInPage(TYPES.map((type) => buildFlowkoSnippet({ ...base, type })).join("\n"));
      expect(queues(win).scripts).toEqual([EMBED_LIB_URL]);
      expect(Object.keys(win.Cal.ns)).toEqual(["ogled", "ogled_lebdeci", "ogled_gumb", "ogled_povezava"]);
      expect(queues(win).q).toEqual(Object.keys(win.Cal.ns).map((namespace) => ["initNamespace", namespace]));
      expect(win.document.querySelector('button[data-cal-namespace="ogled_gumb"]')).not.toBeNull();
    });
  });

  describe("click-link (the client's own button)", () => {
    const setup = (links: string) => {
      const win = runInPage(`${links}\n${buildFlowkoSnippet({ ...base, type: "click-link" })}`);
      const modalCalls = () =>
        JSON.parse(
          JSON.stringify(
            win.Cal.ns.ogled_povezava.q.filter((args) => args[0] === "modal").map((args) => Array.from(args))
          )
        );
      const click = (el: Element, init: MouseEventInit = {}) => {
        const event = new win.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
        el.dispatchEvent(event);
        return event;
      };
      return { win, modalCalls, click };
    };

    it("opens the pop-up for a link to the booking page and keeps the visitor on the page", () => {
      const { win, modalCalls, click } = setup(
        `<a id="a" href="https://booking.flowko.si/flowko-test/ogled"><span id="inner">Rezervirajte termin</span></a>
         <a id="slash" href="https://booking.flowko.si/flowko-test/ogled/?utm_source=site" target="_blank">x</a>`
      );
      const event = click(win.document.getElementById("inner") as Element);
      expect(event.defaultPrevented).toBe(true);
      expect(click(win.document.getElementById("slash") as Element).defaultPrevented).toBe(true);
      expect(modalCalls()).toEqual([
        ["modal", { calLink: "flowko-test/ogled", config: { layout: "month_view", theme: "light" } }],
        ["modal", { calLink: "flowko-test/ogled", config: { layout: "month_view", theme: "light" } }],
      ]);
    });

    it("leaves other links, modified clicks and other mouse buttons alone", () => {
      const { win, modalCalls, click } = setup(
        `<a id="other-event" href="https://booking.flowko.si/flowko-test/posvet">x</a>
         <a id="other-origin" href="https://example.com/flowko-test/ogled">x</a>
         <a id="embed-route" href="https://booking.flowko.si/flowko-test/ogled/embed">x</a>
         <a id="relative" href="/flowko-test/ogled">x</a>
         <a id="ok" href="https://booking.flowko.si/flowko-test/ogled">x</a>
         <button id="not-a-link">x</button>`
      );
      const byId = (id: string) => win.document.getElementById(id) as Element;
      for (const id of ["other-event", "other-origin", "embed-route", "relative", "not-a-link"]) {
        expect(click(byId(id)).defaultPrevented).toBe(false);
      }
      for (const init of [
        { metaKey: true },
        { ctrlKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
      ]) {
        expect(click(byId("ok"), init).defaultPrevented).toBe(false);
      }
      expect(modalCalls()).toEqual([]);
    });

    // Flowko (U13 fix pass): embed.ts's own document listener opens the pop-up for a data-cal-link element
    // (Webflow's custom attributes on the same link, guide §7.5); the script handled it too and opened two
    it("leaves a link with data-cal-link, or inside or around one, to embed.js", () => {
      const { win, modalCalls, click } = setup(
        `<a id="on" href="https://booking.flowko.si/flowko-test/ogled" data-cal-link="flowko-test/ogled"
            data-cal-namespace="ogled"><span id="on-inner">x</span></a>
         <div data-cal-link="flowko-test/ogled">
           <a id="inside" href="https://booking.flowko.si/flowko-test/ogled">x</a></div>
         <a href="https://booking.flowko.si/flowko-test/ogled">
           <span id="holds" data-cal-link="flowko-test/ogled">x</span></a>`
      );
      for (const id of ["on", "on-inner", "inside", "holds"]) {
        expect(click(win.document.getElementById(id) as Element).defaultPrevented).toBe(false);
      }
      expect(modalCalls()).toEqual([]);
    });
  });

  describe("escaping and validation", () => {
    it("button text can't break out of the HTML or the script", () => {
      const text = `Book </script><img src=x onerror=alert(1)> "now" & 'today'`;
      const click = buildFlowkoSnippet({ ...base, type: "element-click", buttonText: text });
      expect(click).toContain(
        ">Book &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &quot;now&quot; &amp; &#39;today&#39;</button>"
      );
      const floating = buildFlowkoSnippet({ ...base, type: "floating-popup", buttonText: text });
      expect(floating.match(/<\/script>/g)).toHaveLength(1);
      expect(floating).toContain(
        `"buttonText": "Book \\u003c/script>\\u003cimg src=x onerror=alert(1)> \\"now\\" & 'today'"`
      );
      const win = runInPage(floating);
      expect(win.Cal.ns.ogled_lebdeci.q[1][1]).toMatchObject({ buttonText: text });
    });

    it("blank button text falls back to the default for the language", () => {
      expect(buildFlowkoSnippet({ ...base, type: "element-click", buttonText: "  ", lang: "en" })).toContain(
        ">Book an appointment</button>"
      );
    });

    it("floating button: text colour follows the button colour's contrast unless given", () => {
      const light = buildFlowkoSnippet({ ...base, type: "floating-popup", buttonColor: "#FFD700" });
      expect(light).toContain('"buttonColor": "#FFD700"');
      expect(light).toContain('"buttonTextColor": "#000000"');
      const dflt = buildFlowkoSnippet({ ...base, type: "floating-popup", buttonColor: undefined });
      expect(dflt).toContain(`"buttonColor": "${DEFAULT_LIGHT_BRAND_COLOR}"`);
      expect(dflt).toContain('"buttonTextColor": "#FFFFFF"');
      const custom = buildFlowkoSnippet({
        ...base,
        type: "floating-popup",
        buttonTextColor: "#fff",
        buttonPosition: "bottom-left",
        hideButtonIcon: true,
      });
      expect(custom).toContain(
        '"buttonTextColor": "#fff",\n    "buttonPosition": "bottom-left",\n    "hideButtonIcon": true\n  });'
      );
    });

    it("inline: window size and a namespace that isn't a CSS identifier", () => {
      const output = buildFlowkoSnippet({
        type: "inline",
        calLink: "dr.novak/pregled.zob",
        origin: ORIGIN,
        embedLibUrl: EMBED_LIB_URL,
        width: "600",
        height: "80vh",
      });
      expect(output).toContain(
        '<div id="flowko-rezervacije-pregled-zob" style="width:600%;height:80vh;overflow:scroll">'
      );
      expect(output).toContain('elementOrSelector: "#flowko-rezervacije-pregled-zob"');
      expect(output).toContain('Cal.ns["pregled.zob"]("inline"');
      const win = runInPage(output);
      expect(win.document.querySelector("#flowko-rezervacije-pregled-zob")).not.toBeNull();
    });

    it("the namespace defaults to the event-type slug", () => {
      const output = buildFlowkoSnippet({
        type: "inline",
        calLink: "flowko-test/ogled",
        origin: ORIGIN,
        embedLibUrl: EMBED_LIB_URL,
      });
      expect(output).toBe(buildFlowkoSnippet({ ...base, type: "inline", buttonColor: undefined }));
    });

    it("normalises the origin", () => {
      expect(buildFlowkoSnippet({ ...base, type: "inline", origin: "https://booking.flowko.si/" })).toBe(
        buildFlowkoSnippet({ ...base, type: "inline" })
      );
    });

    it.each([
      [{ calLink: "" }],
      [{ calLink: "/flowko-test/ogled" }],
      [{ calLink: "flowko-test/ogled/" }],
      [{ calLink: "https://booking.flowko.si/flowko-test/ogled" }],
      [{ calLink: "flowko-test/ogled?x=1" }],
      [{ origin: "booking.flowko.si" }],
      [{ origin: "javascript:alert(1)" }],
      [{ embedLibUrl: "embed.js" }],
      [{ type: "floating-popup" as const, buttonColor: "red" }],
      [{ type: "floating-popup" as const, buttonTextColor: "#12345" }],
      [{ type: "floating-popup" as const, buttonPosition: "top-left" as never }],
      [{ theme: "blue" as never }],
      [{ layout: "grid" as never }],
      [{ lang: "de" as never }],
      [{ type: "headless" as never }],
    ])("refuses %j", (override) => {
      expect(() => buildFlowkoSnippet({ ...base, type: "inline", ...override })).toThrow();
    });
  });

  describe("constants stay in sync", () => {
    it("default button text = the flowko_book_button key", () => {
      for (const lang of LANGS) {
        const locale = JSON.parse(
          readFileSync(path.join(__dirname, `../../../i18n/locales/${lang}/common.json`), "utf8")
        );
        expect(FLOWKO_BOOK_BUTTON_TEXT[lang]).toBe(locale.flowko_book_button);
      }
    });

    it("default button colour = DEFAULT_LIGHT_BRAND_COLOR", () => {
      expect(FLOWKO_DEFAULT_BUTTON_COLOR).toBe(DEFAULT_LIGHT_BRAND_COLOR);
    });

    it.each(
      ["ogled", "a-b", "a$b", "pregled.zob", "_x1", "30-minut"].flatMap((slug) =>
        TYPES.map((type) => [slug, type] as const)
      )
    )("namespace API for %s (%s) = getApiName.tsx", (slug, type) => {
      const output = buildFlowkoSnippet({ ...base, type, calLink: `u/${slug}`, namespace: slug });
      const namespace = getFlowkoNamespace(type, slug);
      expect(output).toContain(`  Cal("init", ${JSON.stringify(namespace)}, {`);
      expect(output).toContain(`  ${getApiNameWithNamespace({ namespace, mainApiName: "Cal" })}("ui", `);
    });

    // Flowko P0: the calendar keeps the slug; each pop-up type adds its own suffix, which starts with "_"
    it("namespace per type: the slug for the calendar, a distinct _suffix for each pop-up type", () => {
      expect(TYPES.map((type) => getFlowkoNamespace(type, "ogled"))).toEqual([
        "ogled",
        "ogled_lebdeci",
        "ogled_gumb",
        "ogled_povezava",
      ]);
      expect(FLOWKO_NAMESPACE_SUFFIX.inline).toBe("");
      for (const type of TYPES.filter((t) => t !== "inline")) {
        const namespace = getFlowkoNamespace(type, "pregled-zob");
        expect(namespace).toMatch(/^pregled-zob_[a-z]+$/);
        // slugify (the app's forms, the create input) turns "_" into "-", and update and duplicate refuse a slug
        // with "_" (reservedSlug.test.ts), so no stored slug is another code's namespace
        expect(slugify(namespace)).toBe(namespace.replace("_", "-"));
      }
    });
  });
});
