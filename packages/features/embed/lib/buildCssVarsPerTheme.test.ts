import { describe, expect, it, vi } from "vitest";

import useGetBrandingColours, { getWCAGContrastColor } from "@calcom/lib/getBrandColours";

import {
  buildBrandCssVars,
  buildCssVarsPerTheme,
  getContrastTextColor,
  getPinnedBrandColors,
  isValidBrandColor,
} from "./buildCssVarsPerTheme";

// Flowko U13-06: the palette a snippet pins must be exactly what the booker derives from the same colour,
// otherwise pinning the profile colour would still change the booker's look.

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useBrandColors: () => ({}),
}));

const COLORS = [
  "#292929",
  "#fafafa",
  "#0F766E",
  "#0f766e",
  "#FFD700",
  "#1E3A8A",
  "#000000",
  "#FFFFFF",
  "#7f7f7f",
  "#808080",
  "#ff0000",
  "#00ff00",
  "#abc",
  "#FfF",
];

describe("buildCssVarsPerTheme", () => {
  it.each(COLORS)("the light and dark palettes of %s equal the booker's (useGetBrandingColours)", (color) => {
    const booker = useGetBrandingColours({ lightVal: color, darkVal: color });
    expect(buildBrandCssVars(color, "light")).toEqual(booker.light);
    expect(buildBrandCssVars(color, "dark")).toEqual(booker.dark);
  });

  it("sweeps the colour space: contrast text colour equals getWCAGContrastColor", () => {
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 17)
        for (let b = 0; b < 256; b += 17) {
          const color = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          expect(getContrastTextColor(color)).toBe(getWCAGContrastColor(color));
        }
  });

  it("getWCAGContrastColor accepts a 3-digit colour", () => {
    expect(getWCAGContrastColor("#fff")).toBe("#000000");
    expect(getWCAGContrastColor("#000")).toBe("#FFFFFF");
    expect(getWCAGContrastColor("#0F766E")).toBe("#FFFFFF");
  });

  it("a palette only for themes that have a colour", () => {
    expect(buildCssVarsPerTheme({ brandColor: null, darkBrandColor: null })).toBeUndefined();
    expect(Object.keys(buildCssVarsPerTheme({ brandColor: "#0F766E", darkBrandColor: null }) ?? {})).toEqual([
      "light",
    ]);
    expect(Object.keys(buildCssVarsPerTheme({ brandColor: null, darkBrandColor: "#fafafa" }) ?? {})).toEqual([
      "dark",
    ]);
    expect(buildCssVarsPerTheme({ brandColor: "#0F766E", darkBrandColor: null })?.light).toEqual({
      "cal-brand": "#0F766E",
      "cal-brand-emphasis": "#579f9a",
      "cal-brand-subtle": "#c3dddb",
      "cal-brand-text": "#FFFFFF",
      "cal-brand-accent": "#FFFFFF",
    });
  });

  it("refuses a colour that isn't hex", () => {
    expect(() => buildBrandCssVars("red", "light")).toThrow();
    expect(() => getContrastTextColor("#12345")).toThrow();
    expect(isValidBrandColor("#12345")).toBe(false);
    expect(isValidBrandColor("#123")).toBe(true);
    expect(isValidBrandColor(null)).toBe(false);
  });
});

describe("getPinnedBrandColors", () => {
  const profile = { brandColor: "#0F766E", darkBrandColor: "#fafafa" };

  it("pins nothing when the host didn't pick a colour", () => {
    expect(getPinnedBrandColors({ picked: { brandColor: null, darkBrandColor: null }, profile })).toEqual({
      brandColor: null,
      darkBrandColor: null,
    });
  });

  it("pins nothing when the picked colour is the profile colour, in any spelling", () => {
    expect(
      getPinnedBrandColors({ picked: { brandColor: "#0f766e", darkBrandColor: "#FAFAFA" }, profile })
    ).toEqual({ brandColor: null, darkBrandColor: null });
    expect(
      getPinnedBrandColors({
        picked: { brandColor: "#fff", darkBrandColor: null },
        profile: { brandColor: "#FFFFFF", darkBrandColor: "#fafafa" },
      })
    ).toEqual({ brandColor: null, darkBrandColor: null });
  });

  it("pins each theme whose colour differs", () => {
    expect(
      getPinnedBrandColors({ picked: { brandColor: "#123456", darkBrandColor: "#fafafa" }, profile })
    ).toEqual({ brandColor: "#123456", darkBrandColor: null });
    expect(
      getPinnedBrandColors({ picked: { brandColor: "#0F766E", darkBrandColor: "#111111" }, profile })
    ).toEqual({ brandColor: null, darkBrandColor: "#111111" });
  });

  it("ignores a colour that isn't hex", () => {
    expect(getPinnedBrandColors({ picked: { brandColor: "#12", darkBrandColor: "blue" }, profile })).toEqual({
      brandColor: null,
      darkBrandColor: null,
    });
  });
});
