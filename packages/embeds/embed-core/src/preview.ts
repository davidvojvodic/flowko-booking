import {
  getAllowedBookerOrigin,
  getPreviewButtonText,
  isAllowedEmbedLibUrl,
  isFramedByWebapp,
  isMessageFromWebapp,
} from "./lib/previewPage";

// We can't import @calcom/lib/constants here yet as this file is compiled using Vite
const WEBAPP_URL = process.env.EMBED_PUBLIC_WEBAPP_URL || "";
if (!WEBAPP_URL) {
  throw new Error("WEBAPP_URL is not set");
}
// Flowko U13-16: the same default as EMBED_LIB_URL in packages/lib/constants.ts, which is the value
// the Embed dialog passes as embedLibUrl (upstream's default here was WEBAPP_URL itself)
const EMBED_LIB_URL = process.env.EMBED_PUBLIC_EMBED_LIB_URL || `${WEBAPP_URL}/embed/embed.js`;
const IS_E2E = process.env.NEXT_PUBLIC_IS_E2E === "1";

// Because it is only used in Embed Snippet Generator preview that is accessible through dashboard only which has URL WEBAPP_URL, we are good with this strict restriction
// Flowko U13-16: the referrer's origin must equal WEBAPP_URL's; a prefix match let https://<host>.evil.com through
if (
  !IS_E2E &&
  !isFramedByWebapp({
    isTopLevel: window.self === window.top,
    referrer: document.referrer,
    webappUrl: WEBAPP_URL,
  })
) {
  throw new Error(`This page can only be accessed within an iframe from ${WEBAPP_URL}`);
}

const searchParams = new URL(document.URL).searchParams;
const embedType = searchParams.get("embedType");
const calLink = searchParams.get("calLink");
const bookerUrl = searchParams.get("bookerUrl");
const embedLibUrl = searchParams.get("embedLibUrl");

if (!bookerUrl || !embedLibUrl) {
  throw new Error('Can\'t Preview: Missing "bookerUrl" or "embedLibUrl" query parameter');
}

// Flowko U13-16: exactly the app's embed.js and the app's own origin, instead of any URL on
// localhost or on the same last two host labels
if (!isAllowedEmbedLibUrl({ embedLibUrl, expectedEmbedLibUrl: EMBED_LIB_URL })) {
  throw new Error('Invalid "embedLibUrl".');
}

const bookerOrigin = getAllowedBookerOrigin({ bookerUrl, webappUrl: WEBAPP_URL });
if (!bookerOrigin) {
  throw new Error('Invalid "bookerUrl".');
}

// Flowko U13-14: the embed's own texts follow the page's <html lang> (no lang: Slovenian). The dialog
// may pass its interface language as `lang`.
const previewLang = searchParams.get("lang");
if (previewLang && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(previewLang)) {
  document.documentElement.lang = previewLang;
}

if (!calLink) {
  throw new Error('Missing "calLink" query parameter');
}

// TODO: Reuse the embed code snippet from the embed-snippet package - Not able to use it because of circular dependency
// Install Cal Embed Code Snippet
(function (C, A, L) {
  // @ts-expect-error
  const p = function (a, ar) {
    a.q.push(ar);
  };
  const d = C.document;
  C.Cal =
    C.Cal ||
    function () {
      const cal = C.Cal;

      // eslint-disable-next-line prefer-rest-params
      const ar = arguments;
      if (!cal.loaded) {
        cal.ns = {};
        cal.q = cal.q || [];
        d.head.appendChild(d.createElement("script")).src = A;
        cal.loaded = true;
      }
      if (ar[0] === L) {
        const api = function () {
          // eslint-disable-next-line prefer-rest-params
          p(api, arguments);
        };
        const namespace = ar[1];
        // @ts-expect-error
        api.q = api.q || [];
        if (typeof namespace === "string") {
          // Make sure that even after re-execution of the snippet, the namespace is not overridden
          cal.ns[namespace] = cal.ns[namespace] || api;
          p(cal.ns[namespace], ar);
          p(cal, ["initNamespace", namespace]);
        } else p(cal, ar);
        return;
      }
      p(cal, ar);
    };
})(window, embedLibUrl, "init");
const previewWindow = window;
previewWindow.Cal.fingerprint = process.env.EMBED_PUBLIC_EMBED_FINGER_PRINT as string;
previewWindow.Cal.version = process.env.EMBED_PUBLIC_EMBED_VERSION as string;

previewWindow.Cal("init", {
  origin: bookerOrigin,
});

if (embedType === "inline") {
  previewWindow.Cal("inline", {
    elementOrSelector: "#my-embed",
    calLink: calLink,
  });
} else if (embedType === "floating-popup") {
  previewWindow.Cal("floatingButton", {
    calLink: calLink,
    attributes: {
      id: "my-floating-button",
    },
  });
} else if (embedType === "element-click") {
  const button = document.createElement("button");
  button.setAttribute("data-cal-link", calLink);
  // Flowko U13-14: the button the Embed dialog's code gives the client, in the page's language
  button.textContent = getPreviewButtonText(document.documentElement.lang);
  document.body.appendChild(button);
}

previewWindow.addEventListener("message", (e) => {
  // Flowko U13-16: only the Embed dialog (the parent page, on WEBAPP_URL) drives the preview
  if (!isMessageFromWebapp({ origin: e.origin, source: e.source, parent: window.parent, webappUrl: WEBAPP_URL })) {
    return;
  }
  const data = e.data;
  if (!data || data.mode !== "cal:preview") {
    return;
  }

  const globalCal = window.Cal;
  if (!globalCal) {
    throw new Error("Cal is not defined yet");
  }
  if (data.type == "instruction") {
    globalCal(data.instruction.name, data.instruction.arg);
  }
  if (data.type == "inlineEmbedDimensionUpdate") {
    const inlineEl = document.querySelector<HTMLElement>("#my-embed");
    if (inlineEl) {
      inlineEl.style.width = data.data.width;
      inlineEl.style.height = data.data.height;
    }
  }
});

function makePreviewPageUseSystemPreference() {
  const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function handleColorSchemeChange(e: MediaQueryListEvent) {
    if (e.matches) {
      // Dark color scheme
      document.body.classList.remove("light");
      document.body.classList.add("dark");
    } else {
      // Light color scheme
      document.body.classList.add("light");
      document.body.classList.remove("dark");
    }
  }

  colorSchemeQuery.addEventListener("change", handleColorSchemeChange);

  // Initial check
  handleColorSchemeChange(new MediaQueryListEvent("change", { matches: colorSchemeQuery.matches }));
}

// This makes preview page behave like a website that has system preference enabled. This provides a better experience of preview when user switch their system theme to dark
makePreviewPageUseSystemPreference();

export {};
