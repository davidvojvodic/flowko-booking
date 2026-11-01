import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FLOWKO_BOOKER_TINTS, FLOWKO_BOOKER_TINTS_DARK } from "@calcom/lib/flowkoBookerTints";

import { useBrandColors } from "./use-brand-colors";

const mocks = vi.hoisted(() => ({
  brandingPin: {} as { brandColor?: string },
  isEmbed: false,
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useBrandColors: () => mocks.brandingPin,
  useIsEmbed: () => mocks.isEmbed,
}));
vi.mock("@calcom/lib/hooks/useTheme", () => ({ default: vi.fn() }));

const root = document.documentElement;
const cssVar = (name: string) => root.style.getPropertyValue(`--${name}`);

function expectValues(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    expect(cssVar(key), key).toBe(value);
  }
}

function expectNoTints() {
  for (const key of Object.keys(FLOWKO_BOOKER_TINTS)) {
    expect(cssVar(key), key).toBe("");
  }
}

function addEmbedCssVars() {
  const style = document.createElement("style");
  style.id = "embed-css-vars";
  document.head.appendChild(style);
}

describe("useBrandColors (Flowko U14)", () => {
  beforeEach(() => {
    mocks.brandingPin = {};
    mocks.isEmbed = false;
    root.removeAttribute("style");
    root.className = "light";
  });

  afterEach(() => {
    cleanup();
    document.head.querySelector("#embed-css-vars")?.remove();
  });

  describe("a host who chose no colour", () => {
    it.each([
      ["the stored upstream default", "#292929"],
      ["the same default in another case", "#292929".toUpperCase()],
      ["the new default", "#7a3fd1"],
      ["nothing stored", null],
      ["an empty value", ""],
    ])("%s: Flowko purple plus every tint", (_label, brandColor) => {
      renderHook(() => useBrandColors({ brandColor, darkBrandColor: null }));

      expect(cssVar("cal-brand")).toBe("#7A3FD1");
      expect(cssVar("cal-brand-text")).toBe("#FFFFFF");
      expectValues(FLOWKO_BOOKER_TINTS);
    });

    it("in dark mode: the dark default and tokens.css's dark values", () => {
      root.className = "dark";

      renderHook(() => useBrandColors({ brandColor: "#292929", darkBrandColor: "#fafafa" }));

      expect(cssVar("cal-brand")).toBe("#AC6AFF");
      expectValues(FLOWKO_BOOKER_TINTS_DARK);
    });

    it("a live switch to dark with a re-render leaves no lavender", () => {
      const { rerender } = renderHook(() => useBrandColors({ brandColor: null, darkBrandColor: null }));
      expectValues(FLOWKO_BOOKER_TINTS);

      root.className = "dark";
      rerender();

      expectValues(FLOWKO_BOOKER_TINTS_DARK);
    });

    it("next-themes changes the class after this hook's effects, with no re-render: still no lavender", async () => {
      renderHook(() => useBrandColors({ brandColor: null, darkBrandColor: null }));
      expectValues(FLOWKO_BOOKER_TINTS);

      root.className = "dark";

      await waitFor(() => expectValues(FLOWKO_BOOKER_TINTS_DARK));
      expect(cssVar("cal-brand")).toBe("#AC6AFF");

      root.className = "light";

      await waitFor(() => expectValues(FLOWKO_BOOKER_TINTS));
      expect(cssVar("cal-brand")).toBe("#7A3FD1");
    });

    it("leaving the page takes the tints off <html>", () => {
      const { unmount } = renderHook(() => useBrandColors({ brandColor: null, darkBrandColor: null }));
      expectValues(FLOWKO_BOOKER_TINTS);

      unmount();

      expectNoTints();
    });
  });

  describe("a host with their own colour", () => {
    it("gets that colour and no tint", () => {
      renderHook(() => useBrandColors({ brandColor: "#0F766E", darkBrandColor: "#fafafa" }));

      expect(cssVar("cal-brand")).toBe("#0F766E");
      expectNoTints();
    });

    it("keeps their stored dark colour in dark mode, with no tint and no purple", () => {
      root.className = "dark";

      renderHook(() => useBrandColors({ brandColor: "#0F766E", darkBrandColor: "#fafafa" }));

      expect(cssVar("cal-brand")).toBe("#fafafa");
      expectNoTints();
    });

    it("moving from a default host's page to theirs takes the tints off", () => {
      const { rerender } = renderHook((props) => useBrandColors(props), {
        initialProps: { brandColor: null as string | null },
      });
      expectValues(FLOWKO_BOOKER_TINTS);

      rerender({ brandColor: "#0F766E" });

      expect(cssVar("cal-brand")).toBe("#0F766E");
      expectNoTints();
    });
  });

  describe("an embed code that pins a colour", () => {
    it("branding pin: the pinned colour and no tint", () => {
      mocks.brandingPin = { brandColor: "#123456" };

      renderHook(() => useBrandColors({ brandColor: "#292929", darkBrandColor: "#fafafa" }));

      expect(cssVar("cal-brand")).toBe("#123456");
      expectNoTints();
    });

    it("a branding pin arriving after the tints were applied takes them off", () => {
      const { rerender } = renderHook(() => useBrandColors({ brandColor: null }));
      expectValues(FLOWKO_BOOKER_TINTS);

      mocks.brandingPin = { brandColor: "#123456" };
      rerender();

      expect(cssVar("cal-brand")).toBe("#123456");
      expectNoTints();
    });

    it("cssVarsPerTheme pin already there: no tint", async () => {
      mocks.isEmbed = true;
      addEmbedCssVars();

      renderHook(() => useBrandColors({ brandColor: "#292929", darkBrandColor: "#fafafa" }));

      await waitFor(() => expectNoTints());
    });

    it("cssVarsPerTheme pin arriving after the tints were applied removes every tint, for good", async () => {
      mocks.isEmbed = true;
      const { rerender } = renderHook(() => useBrandColors({ brandColor: "#292929", darkBrandColor: "#fafafa" }));
      expectValues(FLOWKO_BOOKER_TINTS);

      act(() => addEmbedCssVars());

      await waitFor(() => expectNoTints());

      rerender();

      expectNoTints();
    });

    it("a pin in a live switch to dark stays free of tints", async () => {
      mocks.isEmbed = true;
      renderHook(() => useBrandColors({ brandColor: null }));
      act(() => addEmbedCssVars());
      await waitFor(() => expectNoTints());

      root.className = "dark";
      await new Promise((resolve) => setTimeout(resolve, 0));

      expectNoTints();
    });

    it("outside an embed, the element means nothing and is not watched", async () => {
      addEmbedCssVars();

      renderHook(() => useBrandColors({ brandColor: null }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expectValues(FLOWKO_BOOKER_TINTS);
    });
  });
});
