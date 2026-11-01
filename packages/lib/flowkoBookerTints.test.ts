import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DARK_BRAND_COLOR,
  DEFAULT_LIGHT_BRAND_COLOR,
  LEGACY_DEFAULT_DARK_BRAND_COLOR,
  LEGACY_DEFAULT_LIGHT_BRAND_COLOR,
} from "./constants";
import {
  FLOWKO_BOOKER_TINTS,
  FLOWKO_BOOKER_TINTS_DARK,
  isFlowkoDefaultBrand,
  isFlowkoDefaultDarkBrand,
  normalizeFlowkoBrandColors,
} from "./flowkoBookerTints";

describe("the default colours", () => {
  it("are Flowko's, and the upstream ones are kept as legacy", () => {
    expect(DEFAULT_LIGHT_BRAND_COLOR).toBe("#7A3FD1");
    expect(DEFAULT_DARK_BRAND_COLOR).toBe("#AC6AFF");
    expect(LEGACY_DEFAULT_LIGHT_BRAND_COLOR).toBe("#292929");
    expect(LEGACY_DEFAULT_DARK_BRAND_COLOR).toBe("#fafafa");
  });
});

describe("isFlowkoDefaultBrand", () => {
  it.each([null, undefined, "", "#7A3FD1", "#7a3fd1", "#292929"])("%s counts as no colour chosen", (color) => {
    expect(isFlowkoDefaultBrand(color)).toBe(true);
  });

  it.each(["#0F766E", "#2929", "#AC6AFF", "#fafafa"])("%s is the host's own colour", (color) => {
    expect(isFlowkoDefaultBrand(color)).toBe(false);
  });
});

describe("isFlowkoDefaultDarkBrand", () => {
  it.each([null, undefined, "", "#AC6AFF", "#ac6aff", "#fafafa", "#FAFAFA"])(
    "%s counts as no colour chosen",
    (color) => {
      expect(isFlowkoDefaultDarkBrand(color)).toBe(true);
    }
  );

  it.each(["#0F766E", "#7A3FD1", "#292929"])("%s is the host's own colour", (color) => {
    expect(isFlowkoDefaultDarkBrand(color)).toBe(false);
  });
});

describe("normalizeFlowkoBrandColors", () => {
  it("turns the stored legacy pair into the new defaults", () => {
    expect(normalizeFlowkoBrandColors({ brandColor: "#292929", darkBrandColor: "#FAFAFA" })).toEqual({
      brandColor: "#7A3FD1",
      darkBrandColor: "#AC6AFF",
    });
  });

  it("gives the new defaults when nothing is stored", () => {
    expect(normalizeFlowkoBrandColors({ brandColor: null, darkBrandColor: null })).toEqual({
      brandColor: "#7A3FD1",
      darkBrandColor: "#AC6AFF",
    });
  });

  it("keeps a dark colour the host chose next to a default light colour", () => {
    expect(normalizeFlowkoBrandColors({ brandColor: "#292929", darkBrandColor: "#123456" })).toEqual({
      brandColor: "#7A3FD1",
      darkBrandColor: "#123456",
    });
  });

  it("leaves a host with their own light colour exactly as stored, so their dark mode gets no purple", () => {
    expect(normalizeFlowkoBrandColors({ brandColor: "#0F766E", darkBrandColor: "#fafafa" })).toEqual({
      brandColor: "#0F766E",
      darkBrandColor: "#fafafa",
    });
  });
});

describe("the tints", () => {
  it("are the proposal's values", () => {
    expect(FLOWKO_BOOKER_TINTS).toEqual({
      "cal-bg-muted": "#FCF8FF",
      "cal-bg-subtle": "#FCF8FF",
      "cal-bg-emphasis": "#F0E9FC",
      "cal-border-subtle": "#E8E0F5",
      "cal-border": "#D9CFEA",
      "cal-text-emphasis": "#1A1A2E",
      "cal-text": "#33334D",
      "cal-text-subtle": "#6B6B8A",
    });
  });

  it("have a dark value for each key, equal to the dark block of tokens.css", () => {
    const tokens = readFileSync(join(__dirname, "../config/theme/tokens.css"), "utf8");
    const darkBlock = tokens.slice(tokens.indexOf("\n.dark {"));

    expect(Object.keys(FLOWKO_BOOKER_TINTS_DARK).sort()).toEqual(Object.keys(FLOWKO_BOOKER_TINTS).sort());
    for (const [key, value] of Object.entries(FLOWKO_BOOKER_TINTS_DARK)) {
      expect(darkBlock).toContain(`--${key}: ${value};`);
    }
  });
});
