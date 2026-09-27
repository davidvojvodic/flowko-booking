import type { MutableRefObject } from "react";
import { forwardRef } from "react";

import { useEmbedBookerUrl } from "@calcom/features/bookings/hooks/useBookerUrl";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { TextArea } from "@calcom/ui/components/form";

import type { EmbedType, PreviewState } from "../types";
import { buildCssVarsPerTheme } from "./buildCssVarsPerTheme";
import type {
  FlowkoSnippetLang,
  FlowkoSnippetLayout,
  FlowkoSnippetTheme,
  FlowkoSnippetType,
} from "./buildFlowkoSnippet";
import { buildFlowkoSnippet } from "./buildFlowkoSnippet";
import { embedLibUrl, EMBED_PREVIEW_HTML_URL } from "./constants";
import { useEmbedCalOrigin } from "./hooks";

// Flowko U13-04/05: a tab's `id` is what Embed.tsx matches; its `name` is only the label, an i18n key that
// HorizontalTabItem translates. Only the HTML code and the preview are left (Q10): the React (iframe) and
// React (Atom) tabs are gone, and Atom needs API v2, which this fork must not deploy (FLOWKO.md).
export const enum EmbedTabName {
  HTML = "embed-code",
  PREVIEW = "embed-preview",
}

/** The snippet the dialog shows for an embed type; element-click has our button and the client's own button. */
export function getFlowkoSnippetType(
  embedType: EmbedType,
  previewState: Pick<PreviewState, "elementClick">
): FlowkoSnippetType | null {
  if (embedType === "element-click") {
    return previewState.elementClick.variant === "link" ? "click-link" : "element-click";
  }
  if (embedType === "inline" || embedType === "floating-popup") return embedType;
  return null;
}

export function getSnippetLang(language: string | undefined): FlowkoSnippetLang {
  return language?.toLowerCase().startsWith("sl") ? "sl" : "en";
}

/**
 * Flowko U13-01: the dialog's HTML code comes from the same builder as the welcome e-mail's.
 * `previewState` is the one Embed.tsx resolves: default button text and colours filled in, and `palette`
 * holding only colours that differ from the profile's (U13-06).
 */
export function getDialogSnippet({
  embedType,
  calLink,
  namespace,
  previewState,
  origin,
  lang,
}: {
  embedType: EmbedType;
  calLink: string;
  namespace: string;
  previewState: PreviewState;
  origin: string;
  lang: FlowkoSnippetLang;
}) {
  const type = getFlowkoSnippetType(embedType, previewState);
  if (!type) return "";
  return buildFlowkoSnippet({
    type,
    calLink,
    namespace,
    origin,
    embedLibUrl,
    theme: previewState.theme as FlowkoSnippetTheme,
    layout: previewState.layout as FlowkoSnippetLayout,
    hideEventTypeDetails: previewState.hideEventTypeDetails,
    width: previewState.inline.width,
    height: previewState.inline.height,
    buttonText:
      type === "floating-popup"
        ? previewState.floatingPopup.buttonText
        : previewState.elementClick.buttonText,
    buttonColor: previewState.floatingPopup.buttonColor,
    buttonTextColor: previewState.floatingPopup.buttonTextColor,
    buttonPosition: previewState.floatingPopup.buttonPosition,
    hideButtonIcon: previewState.floatingPopup.hideButtonIcon,
    cssVarsPerTheme: buildCssVarsPerTheme(previewState.palette),
    lang,
  });
}

/** Flowko U13-04: where the code goes, per snippet (replaces the one "where the widget appears" line). */
function getSnippetHint(
  t: ReturnType<typeof useLocale>["t"],
  type: FlowkoSnippetType | null,
  bookingUrl: string
): string {
  switch (type) {
    case "inline":
      return t("embed_hint_inline");
    case "floating-popup":
      return t("embed_hint_floating");
    case "element-click":
      return t("embed_hint_click_button");
    case "click-link":
      return t("embed_hint_click_link", { url: bookingUrl, interpolation: { escapeValue: false } });
    default:
      return "";
  }
}

export const tabs = [
  {
    id: EmbedTabName.HTML,
    name: "embed_tab_html",
    href: `embedTabName=${EmbedTabName.HTML}`,
    icon: "code" as const,
    type: "code",
    "data-testid": "HTML",
    Component: forwardRef<
      HTMLTextAreaElement | HTMLIFrameElement | null,
      { embedType: EmbedType; calLink: string; previewState: PreviewState; namespace: string }
    >(function EmbedHtml({ embedType, calLink, previewState, namespace }, ref) {
      const { t, i18n } = useLocale();
      const embedCalOrigin = useEmbedCalOrigin();
      if (ref instanceof Function || !ref) {
        return null;
      }
      if (ref.current && !(ref.current instanceof HTMLTextAreaElement)) {
        return null;
      }
      const snippetType = getFlowkoSnippetType(embedType, previewState);
      let code = "";
      try {
        code = getDialogSnippet({
          embedType,
          calLink,
          namespace,
          previewState,
          origin: embedCalOrigin,
          lang: getSnippetLang(i18n.language),
        });
      } catch (error) {
        // An event type link the builder refuses; the dialog shows no code rather than breaking the page.
        console.error("Embed code could not be built", error);
      }
      const hint = getSnippetHint(t, snippetType, `${embedCalOrigin}/${calLink}`);
      return (
        <>
          <div>
            <small className="text-subtle flex py-2" data-testid="embed-code-hint">
              {hint}
            </small>
          </div>
          <TextArea
            data-testid="embed-code"
            ref={ref as typeof ref & MutableRefObject<HTMLTextAreaElement>}
            name="embed-code"
            className="text-default bg-default h-[calc(100%-50px)] font-mono"
            style={{ resize: "none", overflow: "auto" }}
            readOnly
            value={code}
          />
          <p className="text-subtle hidden text-sm">{t("need_help_embedding")}</p>
        </>
      );
    }),
  },
  {
    id: EmbedTabName.PREVIEW,
    name: "preview",
    href: `embedTabName=${EmbedTabName.PREVIEW}`,
    icon: "trello" as const,
    type: "iframe",
    "data-testid": "Preview",
    Component: forwardRef<
      HTMLIFrameElement | HTMLTextAreaElement | null,
      { calLink: string; embedType: EmbedType; previewState: PreviewState; namespace: string }
    >(function Preview({ calLink, embedType }, ref) {
      const bookerUrl = useEmbedBookerUrl();
      const iframeSrc = `${EMBED_PREVIEW_HTML_URL}?embedType=${embedType}&calLink=${calLink}&embedLibUrl=${embedLibUrl}&bookerUrl=${bookerUrl}`;
      if (ref instanceof Function || !ref) {
        return null;
      }
      if (ref.current && !(ref.current instanceof HTMLIFrameElement)) {
        return null;
      }
      return (
        <iframe
          ref={ref as typeof ref & MutableRefObject<HTMLIFrameElement>}
          data-testid="embed-preview"
          className="rounded-md border"
          width="100%"
          height="100%"
          src={iframeSrc}
          key={iframeSrc}
        />
      );
    }),
  },
];
