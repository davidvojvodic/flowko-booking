// Flowko U13-06: a snippet pins brand colours only for a theme whose colour the host changed in the Embed
// dialog. Left out, the embedded booker follows Settings -> Appearance live (BookerWebWrapper applies the
// profile's brandColor). When a colour is pinned, the whole palette the booker derives from it is pinned,
// the same five variables `useGetBrandingColours` (packages/lib/getBrandColours.tsx) computes; upstream
// pinned only --cal-brand, so button text computed from the profile colour could become unreadable.
// This module is pure (no React, env or window): buildFlowkoSnippet.ts and the Vault's snippet CLI import it.
// `buildCssVarsPerTheme.test.ts` pins its output to useGetBrandingColours.

export type BrandCssVars = {
  "cal-brand": string;
  "cal-brand-emphasis": string;
  "cal-brand-subtle": string;
  "cal-brand-text": string;
  "cal-brand-accent": string;
};

export type CssVarsPerTheme = {
  light?: BrandCssVars;
  dark?: BrandCssVars;
};

export type BrandColors = {
  brandColor: string | null;
  darkBrandColor: string | null;
};

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc" or "#aabbcc" (the "#" optional), as six hex digits without "#", case kept; null otherwise. */
function toSixDigitHex(color: string): string | null {
  const match = HEX_COLOR.exec(color.trim());
  if (!match) return null;
  const hex = match[1];
  return hex.length === 3
    ? hex
        .split("")
        .map((digit) => digit + digit)
        .join("")
    : hex;
}

export function isValidBrandColor(color: string | null | undefined): color is string {
  return typeof color === "string" && toSixDigitHex(color) !== null;
}

function toRgb(hex: string) {
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number) {
  const part = (channel: number) => `0${channel.toString(16)}`.slice(-2);
  return `#${part(r)}${part(g)}${part(b)}`;
}

function lighten(hex: string, intensity: number) {
  const { r, g, b } = toRgb(hex);
  return toHex(
    Math.round(r + (255 - r) * intensity),
    Math.round(g + (255 - g) * intensity),
    Math.round(b + (255 - b) * intensity)
  );
}

function darken(hex: string, intensity: number) {
  const { r, g, b } = toRgb(hex);
  return toHex(Math.round(r * intensity), Math.round(g * intensity), Math.round(b * intensity));
}

/** White or black text on `background`, by the same rule as the booker (`getWCAGContrastColor`). */
export function getContrastTextColor(background: string): "#FFFFFF" | "#000000" {
  const hex = toSixDigitHex(background);
  if (!hex) throw new Error(`Not a hex colour: ${background}`);
  const { r, g, b } = toRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5 ? "#FFFFFF" : "#000000";
}

/** The five brand variables the booker derives from one colour (light: 400/200 tints, dark: 600/800 shades). */
export function buildBrandCssVars(color: string, theme: "light" | "dark"): BrandCssVars {
  const hex = toSixDigitHex(color);
  if (!hex) throw new Error(`Not a hex colour: ${color}`);
  const brand = `#${hex}`;
  const contrast = getContrastTextColor(brand);
  return {
    "cal-brand": brand,
    "cal-brand-emphasis": theme === "light" ? lighten(hex, 0.3) : darken(hex, 0.9),
    "cal-brand-subtle": theme === "light" ? lighten(hex, 0.75) : darken(hex, 0.6),
    "cal-brand-text": contrast,
    "cal-brand-accent": contrast,
  };
}

/** The full palette for every theme that has a colour; undefined when neither has one. */
export function buildCssVarsPerTheme({
  brandColor,
  darkBrandColor,
}: BrandColors): CssVarsPerTheme | undefined {
  const cssVarsPerTheme: CssVarsPerTheme = {};
  if (brandColor) cssVarsPerTheme.light = buildBrandCssVars(brandColor, "light");
  if (darkBrandColor) cssVarsPerTheme.dark = buildBrandCssVars(darkBrandColor, "dark");
  return Object.keys(cssVarsPerTheme).length ? cssVarsPerTheme : undefined;
}

function isSameColor(a: string, b: string) {
  return toSixDigitHex(a)?.toLowerCase() === toSixDigitHex(b)?.toLowerCase();
}

/**
 * The colours a snippet pins: a colour the host picked in the dialog that differs from the profile's
 * effective colour (the caller passes the profile colour with its default already applied). A colour that
 * wasn't picked, isn't a hex colour, or equals the profile colour is null, so the booker follows Appearance.
 */
export function getPinnedBrandColors({
  picked,
  profile,
}: {
  picked: BrandColors;
  profile: { brandColor: string; darkBrandColor: string };
}): BrandColors {
  const pin = (color: string | null, profileColor: string) =>
    isValidBrandColor(color) && !isSameColor(color, profileColor) ? color : null;
  return {
    brandColor: pin(picked.brandColor, profile.brandColor),
    darkBrandColor: pin(picked.darkBrandColor, profile.darkBrandColor),
  };
}
