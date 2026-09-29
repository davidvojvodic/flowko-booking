/**
 * Flowko C1: the floating button sits under cookie-consent banners. Upstream gave it the class
 * z-999999999999 (clamped to the highest layer) and lost its inline z-index to a missing `;`, so it
 * covered the banners' reject buttons. The booking window it opens keeps its own maximum layer.
 */
import { describe, expect, it } from "vitest";

import getFloatingButtonHtml, { FLOATING_BUTTON_Z_INDEX } from "../FloatingButton/FloatingButtonHtml";
import modalBoxHtml from "../ModalBox/ModalBoxHtml";

// The highest layer among the surveyed consent banners (Complianz's banner)
const HIGHEST_CONSENT_LAYER = 99999;

function parseButton(html: string): HTMLButtonElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  const button = template.content.querySelector("button");
  if (!button) throw new Error("the template rendered no <button>");
  return button;
}

function backdropZIndex(): number {
  const template = document.createElement("template");
  template.innerHTML = modalBoxHtml({ pageType: null, externalThemeClass: null as never });
  const css = template.content.querySelector("style")?.textContent ?? "";
  const rule = css.match(/\.my-backdrop\s*\{([^}]*)\}/);
  if (!rule) throw new Error("no .my-backdrop rule in the modal's style");
  const zIndex = rule[1].match(/z-index\s*:\s*(\d+)/);
  if (!zIndex) throw new Error("the .my-backdrop rule sets no z-index");
  return Number(zIndex[1]);
}

describe("C1: the floating button's layer", () => {
  it("is 998, just under the lowest surveyed consent layer (Klaro, 999)", () => {
    expect(FLOATING_BUTTON_Z_INDEX).toBe(998);
  });

  it("the button carries it inline, with its colours, and no z- class", () => {
    const button = parseButton(
      getFloatingButtonHtml({
        buttonText: "Rezervirajte termin",
        buttonClasses: [],
        buttonColor: "rgb(41, 41, 41)",
        buttonTextColor: "rgb(250, 250, 250)",
      })
    );
    expect(button.style.zIndex).toBe("998");
    expect(button.style.backgroundColor).toBe("rgb(41, 41, 41)");
    expect(button.style.color).toBe("rgb(250, 250, 250)");
    expect(Array.from(button.classList).filter((c) => /^z-/.test(c))).toEqual([]);
    // An inline z-index needs a positioned element
    expect(button.classList.contains("fixed")).toBe(true);
  });

  it("keeps the z-index when the colours are undefined (the dataset can lack them)", () => {
    const button = parseButton(
      getFloatingButtonHtml({
        buttonText: "Rezervirajte termin",
        buttonClasses: [],
        buttonColor: undefined as unknown as string,
        buttonTextColor: undefined as unknown as string,
      })
    );
    // "color:undefined;" is dropped on its own; the z-index after it still applies
    expect(button.style.color).toBe("");
    expect(button.style.backgroundColor).toBe("");
    expect(button.style.zIndex).toBe("998");
  });

  it("the booking window's backdrop stays above every consent layer and above the button", () => {
    const zIndex = backdropZIndex();
    expect(zIndex).toBeGreaterThan(HIGHEST_CONSENT_LAYER);
    expect(zIndex).toBeGreaterThan(FLOATING_BUTTON_Z_INDEX);
  });
});
