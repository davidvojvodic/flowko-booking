// Flowko U13-01: the one place that writes the HTML embed code a client pastes into their website. The Embed
// dialog's HTML tab calls it with WEBAPP_URL / EMBED_LIB_URL, and the Vault's welcome-e-mail CLI imports this
// file directly with an explicit origin and embedLibUrl, so both produce byte-identical code. It is a pure
// function: no React, hooks, env or window, and only relative imports of pure modules (the CLI runs it with
// ts-node outside the app). The golden files in __goldens__/ pin the exact output.
//
// Output (plan §3.3/§3.4):
// - a multi-line copy of upstream's loader IIFE (same logic; with the booking.flowko.si origin every loader
//   line is <= 90 chars for namespaces of up to 73 characters (calendar), 65 (floating), 68 (our button) or
//   64 (click-link)) on a <script> that
//   caching/optimisation plugins leave alone (data-cfasync="false" for Cloudflare Rocket Loader, nowprocket
//   for WP Rocket); no data-cookieconsent attribute;
// - theme "light" by default (a dark-mode visitor on a white site would otherwise get a dark booker);
// - no brand colours unless the caller passes cssVarsPerTheme (see buildCssVarsPerTheme.ts), so the booker
//   follows Settings -> Appearance live;
// - element-click writes a real <button>, and "click-link" turns the client's own link to the booking page
//   into a pop-up (it stays a plain link when the script doesn't run);
// - Slovenian or English comments and default button text;
// - Flowko P0: each type has its own namespace (FLOWKO_NAMESPACE_SUFFIX), so the calendar and a pop-up of the
//   same event type work on one page.
import type { CssVarsPerTheme } from "./buildCssVarsPerTheme";
import { getContrastTextColor, isValidBrandColor } from "./buildCssVarsPerTheme";

export type FlowkoSnippetType = "inline" | "floating-popup" | "element-click" | "click-link";
export type FlowkoSnippetLang = "sl" | "en";
export type FlowkoSnippetTheme = "light" | "dark" | "auto";
export type FlowkoSnippetLayout = "month_view" | "week_view" | "column_view";

export type BuildFlowkoSnippetInput = {
  type: FlowkoSnippetType;
  /** `<username>/<event-type slug>`, as in the booking page URL. */
  calLink: string;
  /**
   * The event type's namespace; defaults to the last segment of calLink (the event-type slug), as in the
   * dialog. The inline code uses it as it is, the other types add their FLOWKO_NAMESPACE_SUFFIX.
   */
  namespace?: string;
  /** The booker's origin, e.g. https://booking.flowko.si. */
  origin: string;
  /** e.g. https://booking.flowko.si/embed/embed.js */
  embedLibUrl: string;
  /** Default "light"; "auto" leaves the theme out. */
  theme?: FlowkoSnippetTheme;
  /** Default "month_view". */
  layout?: FlowkoSnippetLayout;
  hideEventTypeDetails?: boolean;
  /** Inline only; a bare number means percent. Default "100%". */
  width?: string;
  height?: string;
  /** Floating button and element-click; blank means the default for `lang`. */
  buttonText?: string;
  /** Floating button; default #292929 (DEFAULT_LIGHT_BRAND_COLOR). */
  buttonColor?: string;
  /** Floating button; default: white or black, whichever reads on buttonColor. */
  buttonTextColor?: string;
  buttonPosition?: "bottom-right" | "bottom-left";
  hideButtonIcon?: boolean;
  /** Pinned brand palette; leave it out to follow Settings -> Appearance live. */
  cssVarsPerTheme?: CssVarsPerTheme;
  /** Language of the comments and the default button text. Default "sl". */
  lang?: FlowkoSnippetLang;
};

/** Same values as the `flowko_book_button` i18n key (en/sl); a test keeps them equal. */
export const FLOWKO_BOOK_BUTTON_TEXT: Record<FlowkoSnippetLang, string> = {
  sl: "Rezervirajte termin",
  en: "Book an appointment",
};

/** DEFAULT_LIGHT_BRAND_COLOR from @calcom/lib/constants (not imported: it reads env). A test keeps them equal. */
export const FLOWKO_DEFAULT_BUTTON_COLOR = "#292929";

/**
 * Flowko P0 (David, 2026-09-28): what each type adds to the event type's namespace. embed.js keeps one `iframe`
 * per namespace (the newest), so while every type used the slug, a calendar's resize messages went to the
 * pop-up's iframe once a pop-up of the same event type had opened on that page. The calendar keeps the bare
 * slug (its <div> id, the reserved-slug rules and codes already pasted stay as they are). The pop-up types add
 * "_" and a word. No stored slug contains "_": slugify (the app's forms, the create input) turns it into "-",
 * and the update and duplicate inputs refuse it (reservedSlug.ts), so no slug is another code's namespace.
 */
export const FLOWKO_NAMESPACE_SUFFIX: Record<FlowkoSnippetType, string> = {
  inline: "",
  "floating-popup": "_lebdeci",
  "element-click": "_gumb",
  "click-link": "_povezava",
};

/** The namespace a code of this type uses for an event type's namespace (by default its slug). */
export function getFlowkoNamespace(type: FlowkoSnippetType, namespace: string): string {
  return `${namespace}${FLOWKO_NAMESPACE_SUFFIX[type]}`;
}

const LABELS: Record<FlowkoSnippetLang, Record<FlowkoSnippetType | "start" | "end", string>> = {
  sl: {
    inline: "koledar na strani",
    "floating-popup": "lebdeči gumb",
    "element-click": "gumb, ki odpre okno za rezervacijo",
    "click-link": "vaši gumbi odprejo okno za rezervacijo",
    start: "začetek",
    end: "konec",
  },
  en: {
    inline: "inline calendar",
    "floating-popup": "floating button",
    "element-click": "button that opens the booking window",
    "click-link": "your buttons open the booking window",
    start: "start",
    end: "end",
  },
};

/** Plan §3.3: the loader is emitted on lines of at most this many characters. */
const MAX_LOADER_LINE = 90;

const SNIPPET_TYPES: FlowkoSnippetType[] = ["inline", "floating-popup", "element-click", "click-link"];
const THEMES: FlowkoSnippetTheme[] = ["light", "dark", "auto"];
const LAYOUTS: FlowkoSnippetLayout[] = ["month_view", "week_view", "column_view"];

/** A JS string literal that can't end the <script> element or break a line. */
function jsString(value: string) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function jsValue(value: string | boolean) {
  return typeof value === "string" ? jsString(value) : String(value);
}

/** `{ "a": 1, "b": "x" }` on one line. */
function inlineObject(entries: [string, string | boolean][]) {
  return `{ ${entries.map(([key, value]) => `${jsString(key)}: ${jsValue(value)}`).join(", ")} }`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** For a single-quoted attribute that holds JSON: its double quotes stay readable. */
function escapeSingleQuotedAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
}

/** `Cal.ns.slug` when the namespace is an identifier, `Cal.ns["a-b"]` otherwise (as getApiName.tsx). */
function namespaceApi(namespace: string) {
  return /^[a-zA-Z_$][a-zA-Z_$0-9]*$/.test(namespace)
    ? `Cal.ns.${namespace}`
    : `Cal.ns[${jsString(namespace)}]`;
}

/** A bare number means percent (as getDimension.tsx). */
function dimension(value: string | undefined) {
  const trimmed = (value ?? "").trim() || "100%";
  return /^\d+$/.test(trimmed) ? `${trimmed}%` : trimmed;
}

function httpUrl(value: string, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must be an http(s) URL: ${value}`);
  }
  return url;
}

function hexColor(value: string, name: string) {
  if (!isValidBrandColor(value)) throw new Error(`${name} must be a hex colour (#rgb or #rrggbb): ${value}`);
  return value.trim();
}

function loaderLines({
  embedLibUrl,
  namespace,
  origin,
}: {
  embedLibUrl: string;
  namespace: string;
  origin: string;
}) {
  // A long namespace would push the init line past 90 characters: its options then go on a line of
  // their own (still one statement). With the booking.flowko.si origin that keeps every loader line at 90 or
  // less for namespaces of up to 73 characters (calendar), 65 (floating), 68 (our button) or 64 (click-link).
  const init = `  Cal("init", ${jsString(namespace)}, { origin: ${jsString(origin)} });`;
  const initLines =
    init.length <= MAX_LOADER_LINE
      ? [init]
      : [`  Cal("init", ${jsString(namespace)},`, `    { origin: ${jsString(origin)} });`];
  // Upstream's snippet (packages/embeds/embed-snippet, EmbedTabs.tsx) statement for statement, on several lines.
  return [
    `<script type="text/javascript" data-cfasync="false" nowprocket>`,
    `  (function (C, A, L) {`,
    `    let p = function (a, ar) { a.q.push(ar); };`,
    `    let d = C.document;`,
    `    C.Cal = C.Cal || function () {`,
    `      let cal = C.Cal; let ar = arguments;`,
    `      if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || [];`,
    `        d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; }`,
    `      if (ar[0] === L) {`,
    `        const api = function () { p(api, arguments); };`,
    `        const namespace = ar[1]; api.q = api.q || [];`,
    `        if (typeof namespace === "string") { cal.ns[namespace] = cal.ns[namespace] || api;`,
    `          p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]); }`,
    `        else p(cal, ar);`,
    `        return;`,
    `      }`,
    `      p(cal, ar);`,
    `    };`,
    `  })(window, ${jsString(embedLibUrl)}, "init");`,
    ...initLines,
  ];
}

export function buildFlowkoSnippet(input: BuildFlowkoSnippetInput): string {
  const { type } = input;
  if (!SNIPPET_TYPES.includes(type)) throw new Error(`Unknown snippet type: ${type}`);
  const lang: FlowkoSnippetLang = input.lang ?? "sl";
  if (lang !== "sl" && lang !== "en") throw new Error(`Unknown snippet language: ${lang}`);
  const theme = input.theme ?? "light";
  if (!THEMES.includes(theme)) throw new Error(`Unknown theme: ${theme}`);
  const layout = input.layout ?? "month_view";
  if (!LAYOUTS.includes(layout)) throw new Error(`Unknown layout: ${layout}`);

  // A path relative to the origin (`<username>/<slug>`, or a team link): not empty, no leading or trailing
  // slash, no whitespace, query, fragment or scheme. It doesn't check the number of segments.
  const calLink = input.calLink.trim();
  if (!calLink || calLink.startsWith("/") || calLink.endsWith("/") || /[\s?#]|:\/\//.test(calLink)) {
    throw new Error(`calLink must be "<username>/<event-type slug>": ${input.calLink}`);
  }
  const eventTypeNamespace = input.namespace?.trim() || calLink.split("/").pop() || "";
  if (!eventTypeNamespace) throw new Error(`No namespace for calLink ${calLink}`);
  const namespace = getFlowkoNamespace(type, eventTypeNamespace);
  const origin = httpUrl(input.origin, "origin").origin;
  const embedLibUrl = httpUrl(input.embedLibUrl, "embedLibUrl").href;
  // The booking page's path as the browser reports it (percent-encoded), for the click-link match.
  const bookingPath = new URL(calLink, `${origin}/`).pathname.replace(/\/$/, "");

  const api = namespaceApi(namespace);
  const labels = LABELS[lang];
  const buttonText = input.buttonText?.trim() || FLOWKO_BOOK_BUTTON_TEXT[lang];
  const themeEntry: [string, string][] = theme === "auto" ? [] : [["theme", theme]];

  const uiArg = {
    ...(theme === "auto" ? {} : { theme }),
    ...(input.cssVarsPerTheme && Object.keys(input.cssVarsPerTheme).length
      ? { cssVarsPerTheme: input.cssVarsPerTheme }
      : {}),
    hideEventTypeDetails: input.hideEventTypeDetails ?? false,
    layout,
  };
  const uiLine =
    "cssVarsPerTheme" in uiArg
      ? // A pinned palette doesn't fit on one line: one key per line.
        `  ${api}("ui", ${JSON.stringify(uiArg, null, 2).replace(/</g, "\\u003c").split("\n").join("\n  ")});`
      : `  ${api}("ui", ${inlineObject(Object.entries(uiArg) as [string, string | boolean][])});`;

  const loader = loaderLines({ embedLibUrl, namespace, origin });
  const lines: string[] = [`<!-- Flowko Rezervacije: ${labels[type]} (${labels.start}) -->`];

  if (type === "inline") {
    const elementId = `flowko-rezervacije-${namespace.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    const style = `width:${dimension(input.width)};height:${dimension(input.height)};overflow:scroll`;
    lines.push(
      `<div id="${escapeHtml(elementId)}" style="${escapeHtml(style)}"></div>`,
      ...loader,
      `  ${api}("inline", {`,
      `    elementOrSelector: ${jsString(`#${elementId}`)},`,
      `    config: ${inlineObject([
        ["layout", layout],
        ["useSlotsViewOnSmallScreen", "true"],
        ...themeEntry,
      ])},`,
      `    calLink: ${jsString(calLink)},`,
      `  });`,
      uiLine
    );
  } else if (type === "floating-popup") {
    const buttonColor = hexColor(input.buttonColor ?? FLOWKO_DEFAULT_BUTTON_COLOR, "buttonColor");
    const buttonTextColor = hexColor(
      input.buttonTextColor ?? getContrastTextColor(buttonColor),
      "buttonTextColor"
    );
    const buttonPosition = input.buttonPosition ?? "bottom-right";
    if (buttonPosition !== "bottom-right" && buttonPosition !== "bottom-left") {
      throw new Error(`Unknown button position: ${buttonPosition}`);
    }
    const entries = [
      `"calLink": ${jsString(calLink)}`,
      `"config": ${inlineObject([["layout", layout], ["useSlotsViewOnSmallScreen", "true"], ...themeEntry])}`,
      `"buttonText": ${jsString(buttonText)}`,
      `"buttonColor": ${jsString(buttonColor)}`,
      `"buttonTextColor": ${jsString(buttonTextColor)}`,
      `"buttonPosition": ${jsString(buttonPosition)}`,
      ...(input.hideButtonIcon ? [`"hideButtonIcon": true`] : []),
    ];
    lines.push(
      ...loader,
      `  ${api}("floatingButton", {`,
      entries.map((entry) => `    ${entry}`).join(",\n"),
      `  });`,
      uiLine
    );
  } else if (type === "element-click") {
    const config = JSON.stringify(Object.fromEntries([["layout", layout], ...themeEntry]));
    // Unstyled on purpose, so it takes on the site's own button CSS; agencies may add a class.
    lines.push(
      `<button type="button" data-cal-link="${escapeHtml(calLink)}" data-cal-namespace="${escapeHtml(namespace)}"`,
      `  data-cal-config='${escapeSingleQuotedAttribute(config)}'>${escapeHtml(buttonText)}</button>`,
      ...loader,
      uiLine
    );
  } else {
    // The client's own button links to the booking page; with this script the link opens the pop-up
    // (embed.ts's documented "modal" instruction), without it the link still opens the booking page.
    // Flowko (U13 fix pass): a click on or inside a data-cal-link element (Webflow's custom attributes on the
    // same link, guide §7.5) is left to embed.ts's own document listener, which opens the pop-up for it;
    // handling it here as well opened two. Same test as embed.ts's getCalLinkEl: the target or an ancestor.
    lines.push(
      ...loader,
      uiLine,
      `  document.addEventListener("click", function (e) {`,
      `    var a = e.target instanceof Element ? e.target.closest("a[href]") : null;`,
      `    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;`,
      `    if (e.target.closest("[data-cal-link]")) return;`,
      `    var u; try { u = new URL(a.href); } catch (_) { return; }`,
      `    if (u.origin !== ${jsString(origin)} || u.pathname.replace(/\\/$/, "") !== ${jsString(
        bookingPath
      )}) return;`,
      `    e.preventDefault();`,
      `    ${api}("modal", { calLink: ${jsString(calLink)}, config: ${inlineObject([
        ["layout", layout],
        ...themeEntry,
      ])} });`,
      `  }, true);`
    );
  }

  lines.push(`</script>`, `<!-- Flowko Rezervacije: ${labels[type]} (${labels.end}) -->`);
  return lines.join("\n");
}
