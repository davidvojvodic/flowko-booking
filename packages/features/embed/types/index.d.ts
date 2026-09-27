import type { Brand } from "@calcom/types/utils";

import type { tabs } from "../lib/EmbedTabs";
import type { useEmbedTypes } from "../lib/hooks";

// Flowko U13-05: no "headless" type (its only branch opened cal.com). "email" stays in the type for the unreachable
// email-embed code in Embed.tsx; useEmbedTypes no longer offers it (Q10: HTML only, three types).
export type EmbedType = "inline" | "floating-popup" | "element-click" | "email";
// Flowko U13-02: element-click gives either our <button> or a site-wide script for the client's own button (link).
export type ElementClickVariant = "button" | "link";
type EmbedConfig = {
  layout?: BookerLayouts;
  theme?: Theme;
  useSlotsViewOnSmallScreen?: "true" | "false";
};

export type EmbedState = {
  embedType: EmbedType | null;
  embedTabName: string | null;
  embedUrl: string | null;
  eventId: string | null;
  namespace: string | null;
  date: string | null;
  month: string | null;
} | null;

export type PreviewState = {
  inline: Brand<
    {
      width: string;
      height: string;
      config?: EmbedConfig;
    },
    "inline"
  >;
  theme: Theme;
  floatingPopup: Brand<
    {
      config?: EmbedConfig;
      hideButtonIcon?: boolean;
      buttonPosition?: "bottom-left" | "bottom-right";
      buttonColor?: string;
      buttonTextColor?: string;
      buttonText?: string;
    },
    "floating-popup"
  >;
  elementClick: Brand<
    {
      config?: EmbedConfig;
      buttonText?: string;
      variant?: ElementClickVariant;
    },
    "element-click"
  >;
  // Flowko U13-06: in the dialog's state, the colours the host picked (null = not touched); the snippet pins only
  // a colour that differs from the profile colour (getPinnedBrandColors).
  palette: {
    brandColor: string | null;
    darkBrandColor: string | null;
  };
  hideEventTypeDetails: boolean;
  layout: BookerLayouts;
};

export type EmbedFramework = "react" | "react-atom" | "HTML";
export type EmbedTabs = typeof tabs;
export type EmbedTypes = ReturnType<typeof useEmbedTypes>;
