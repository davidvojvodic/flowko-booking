import {
  DEFAULT_DARK_BRAND_COLOR,
  DEFAULT_LIGHT_BRAND_COLOR,
  LEGACY_DEFAULT_DARK_BRAND_COLOR,
  LEGACY_DEFAULT_LIGHT_BRAND_COLOR,
} from "./constants";

/**
 * Flowko U14: the surfaces of a booking page whose host chose no colour. Applied by useBrandColors in the browser,
 * never from tokens.css, which is compiled into embed.js. A host with their own colour stays on neutral surfaces.
 */
export const FLOWKO_BOOKER_TINTS: Record<string, string> = {
  "cal-bg-muted": "#FCF8FF",
  "cal-bg-subtle": "#FCF8FF",
  "cal-bg-emphasis": "#F0E9FC",
  "cal-border-subtle": "#E8E0F5",
  "cal-border": "#D9CFEA",
  "cal-text-emphasis": "#1A1A2E",
  "cal-text": "#33334D",
  "cal-text-subtle": "#6B6B8A",
};

/**
 * Each tint's value in tokens.css's .dark block (a test keeps them equal). useCalcomTheme sets values inline on
 * <html> and never removes one, so the dark map must overwrite every tint or a switch to dark would keep lavender.
 */
export const FLOWKO_BOOKER_TINTS_DARK: Record<string, string> = {
  "cal-bg-muted": "hsla(0, 0%, 9%, 1)",
  "cal-bg-subtle": "hsla(0, 0%, 15%, 1)",
  "cal-bg-emphasis": "hsla(0, 0%, 25%, 1)",
  "cal-border-subtle": "hsla(0, 0%, 15%, 1)",
  "cal-border": "hsla(0, 0%, 30%, 1)",
  "cal-text-emphasis": "hsla(0, 0%, 98%, 1)",
  "cal-text": "hsla(0, 0%, 83%, 1)",
  "cal-text-subtle": "hsla(0, 0%, 64%, 1)",
};

const isOneOf = (color: string, ...defaults: string[]) =>
  defaults.some((defaultColor) => defaultColor.toLowerCase() === color.toLowerCase());

/** No colour chosen: nothing stored, or a stored default, from an earlier save or Reset. */
export function isFlowkoDefaultBrand(brandColor: string | null | undefined): boolean {
  return !brandColor || isOneOf(brandColor, DEFAULT_LIGHT_BRAND_COLOR, LEGACY_DEFAULT_LIGHT_BRAND_COLOR);
}

export function isFlowkoDefaultDarkBrand(darkBrandColor: string | null | undefined): boolean {
  return !darkBrandColor || isOneOf(darkBrandColor, DEFAULT_DARK_BRAND_COLOR, LEGACY_DEFAULT_DARK_BRAND_COLOR);
}

/**
 * The colours to use for what a host has stored. The light colour decides: a host with their own light colour keeps
 * both colours as stored, because Videz saves the pair, and a stored "#fafafa" next to a teal must not turn purple.
 */
export function normalizeFlowkoBrandColors({
  brandColor,
  darkBrandColor,
}: {
  brandColor?: string | null;
  darkBrandColor?: string | null;
}): { brandColor?: string | null; darkBrandColor?: string | null } {
  if (!isFlowkoDefaultBrand(brandColor)) {
    return { brandColor, darkBrandColor };
  }
  return {
    brandColor: DEFAULT_LIGHT_BRAND_COLOR,
    darkBrandColor: isFlowkoDefaultDarkBrand(darkBrandColor) ? DEFAULT_DARK_BRAND_COLOR : darkBrandColor,
  };
}
