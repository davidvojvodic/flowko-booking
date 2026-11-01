import { useEffect, useRef, useState } from "react";

import { useBrandColors as useEmbedBrandingPin, useIsEmbed } from "@calcom/embed-core/embed-iframe";
import {
  FLOWKO_BOOKER_TINTS,
  FLOWKO_BOOKER_TINTS_DARK,
  isFlowkoDefaultBrand,
  normalizeFlowkoBrandColors,
} from "@calcom/lib/flowkoBookerTints";
import useGetBrandingColours from "@calcom/lib/getBrandColours";
import useTheme from "@calcom/lib/hooks/useTheme";
import { useCalcomTheme } from "@calcom/ui/styles";

type BrandColors = {
  brandColor?: string | null;
  darkBrandColor?: string | null;
};

const EMBED_CSS_VARS_SELECTOR = "#embed-css-vars";

const hasEmbedCssVars = () => document.head.querySelector(EMBED_CSS_VARS_SELECTOR) !== null;

/**
 * A code's cssVarsPerTheme arrives by postMessage, isn't reactive, and ends up as a <style id="embed-css-vars"> in
 * the head (embed-iframe-init.ts). Once it is there it stays for the life of the page.
 */
const useHasEmbedCssVarsPin = () => {
  const isEmbed = useIsEmbed();
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    if (!isEmbed || isPinned) return;
    if (hasEmbedCssVars()) {
      setIsPinned(true);
      return;
    }
    const observer = new MutationObserver(() => {
      if (hasEmbedCssVars()) setIsPinned(true);
    });
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, [isEmbed, isPinned]);

  return isPinned;
};

/**
 * Flowko U14: a host who chose no colour gets Flowko purple and tints, and a stored upstream default counts as no
 * colour. A host with their own colour, or a code that pins one, gets that colour on neutral surfaces. Used by the
 * booker and the booking success page.
 */
export const useBookerBrandTheme = ({ brandColor, darkBrandColor }: BrandColors) => {
  const brandingPin = useEmbedBrandingPin();
  const hasCssVarsPin = useHasEmbedCssVarsPin();
  const colors = normalizeFlowkoBrandColors({ brandColor, darkBrandColor });
  const brandTheme = useGetBrandingColours({
    lightVal: colors.brandColor,
    darkVal: colors.darkBrandColor,
  });

  const hasTints = isFlowkoDefaultBrand(brandColor) && !brandingPin.brandColor && !hasCssVarsPin;
  const theme = hasTints
    ? {
        light: { ...brandTheme.light, ...FLOWKO_BOOKER_TINTS },
        dark: { ...brandTheme.dark, ...FLOWKO_BOOKER_TINTS_DARK },
      }
    : brandTheme;

  useCalcomTheme(theme);

  const latestTheme = useRef(theme);
  latestTheme.current = theme;

  useEffect(() => {
    if (!hasTints) return;
    const root = document.documentElement;

    // next-themes changes <html>'s class in its provider's effect, after this hook's effects and with no re-render
    // to follow, so useCalcomTheme alone would leave the light values inline on a page that has just gone dark.
    const observer = new MutationObserver(() => {
      const values = latestTheme.current[root.classList.contains("dark") ? "dark" : "light"];
      for (const [key, value] of Object.entries(values)) {
        root.style.setProperty(`--${key}`, value);
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    // useCalcomTheme never removes a property. This runs when a pin arrives, and when leaving the page.
    return () => {
      observer.disconnect();
      for (const key of Object.keys(FLOWKO_BOOKER_TINTS)) {
        root.style.removeProperty(`--${key}`);
      }
    };
  }, [hasTints]);
};

export const useBrandColors = ({
  brandColor,
  darkBrandColor,
  theme,
}: BrandColors & {
  theme?: string | null;
}) => {
  useBookerBrandTheme({ brandColor, darkBrandColor });
  useTheme(theme);
};
