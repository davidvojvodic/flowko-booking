// Flowko U29b (Task 8, S13, S14): the Urnik save bar: the change count (a plural), „Shrani“, „Zavrzi“ (asks once,
// focus on „Prekliči“), the planned-weeks note in „Običajni teden“, busy state, and its place above the phone's
// bottom navigation (outside the grid's scroll container).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RosterSaveBar } from "./RosterSaveBar";
import { localeT } from "./desk.fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));

const onSave = vi.fn();
const onDiscard = vi.fn();

function bar(over: Partial<Parameters<typeof RosterSaveBar>[0]> = {}) {
  return render(
    <RosterSaveBar count={2} busy={false} usualNote={false} onSave={onSave} onDiscard={onDiscard} {...over} />
  );
}

beforeEach(() => {
  onSave.mockReset();
  onDiscard.mockReset();
});
afterEach(cleanup);

describe("RosterSaveBar (S13, S14)", () => {
  it.each([
    [1, "1 sprememba"],
    [2, "2 spremembi"],
    [3, "3 spremembe"],
    [4, "4 spremembe"],
    [5, "5 sprememb"],
    [21, "21 sprememb"],
    [101, "101 sprememba"],
  ])("counts %i changes as „%s“", (count, text) => {
    bar({ count });
    expect(screen.getByTestId("roster-save-count").textContent).toBe(text);
  });

  it("„Shrani“ calls onSave", () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "Shrani" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("orders the buttons „Shrani“ then „Zavrzi“ (D7)", () => {
    bar();
    const save = screen.getByRole("button", { name: "Shrani" });
    const discard = screen.getByRole("button", { name: "Zavrzi" });
    expect(save.compareDocumentPosition(discard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("while saving „Shrani“ is off and „Zavrzi“ too", () => {
    bar({ busy: true });
    expect((screen.getByRole("button", { name: "Shrani" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Zavrzi" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Shrani" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("„Zavrzi“ asks once, with „Prekliči“ focused; confirming discards", () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "Zavrzi" }));
    const dialog = screen.getByRole("dialog", { name: "Zavrzi spremembe?" });
    expect(onDiscard).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Prekliči" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Zavrzi" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("„Prekliči“ in the question keeps the changes", () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "Zavrzi" }));
    const dialog = screen.getByRole("dialog", { name: "Zavrzi spremembe?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Prekliči" }));
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("the usual week's bar carries the planned-weeks note; the week's bar does not", () => {
    bar({ usualNote: true });
    expect(screen.getByTestId("roster-save-note").textContent).toBe(
      "Tedni s posebnim urnikom ostanejo nespremenjeni."
    );
    cleanup();
    bar({ usualNote: false });
    expect(screen.queryByTestId("roster-save-note")).toBeNull();
  });

  it("on a phone it floats above the bottom navigation (bottom-20, z-40, PWA offset) and sticks from md up", () => {
    bar();
    const el = screen.getByTestId("roster-save-bar");
    expect(el.className).toContain("fixed");
    expect(el.className).toContain("inset-x-2");
    expect(el.className).toContain("bottom-20");
    expect(el.className).toContain("z-40");
    expect(el.className).not.toMatch(/(^|\s)pwa:bottom/);
    expect(el.className).toContain("max-md:pwa:bottom-[max(7rem,_calc(5rem_+_env(safe-area-inset-bottom)))]");
    expect(el.className).toContain("md:sticky");
    expect(el.className).toContain("md:bottom-0");
    expect(el.closest('[data-testid="desk-grid-scroll"]')).toBeNull();
    expect(el.closest('[data-testid="roster-grid"]')).toBeNull();
  });
});
