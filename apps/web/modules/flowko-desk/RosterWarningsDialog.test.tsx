// Flowko U29b (Task 8, S14, D10): the combined warnings dialog before a save: per worker (row order) the days with
// shifts outside the opening hours and the bookings that end up outside; „Termini ne bodo prestavljeni.“; in „Običajni
// teden“ the planned-weeks note; „Vseeno shrani“ / „Prekliči“.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RosterWarningsDialog } from "./RosterWarningsDialog";
import { localeT } from "./desk.fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));

const members = [
  { memberId: 2, displayName: "Ana" },
  { memberId: 3, displayName: "Bor" },
];
const onConfirm = vi.fn();
const onClose = vi.fn();

function dialog(over: Partial<Parameters<typeof RosterWarningsDialog>[0]> = {}) {
  return render(
    <RosterWarningsDialog
      open
      mode="week"
      members={members}
      warnings={[{ memberId: 2, outsideOpening: ["2026-11-17"], bookingsNewlyOutside: 1 }]}
      busy={false}
      onConfirm={onConfirm}
      onClose={onClose}
      {...over}
    />
  );
}

beforeEach(() => {
  onConfirm.mockReset();
  onClose.mockReset();
});
afterEach(cleanup);

describe("RosterWarningsDialog (S14)", () => {
  it("lists the worker with the day outside the opening hours and „1 termin“", () => {
    dialog();
    const group = screen.getByTestId("roster-warning-group-2");
    expect(within(group).getByText("Ana")).toBeTruthy();
    expect(group.textContent).toContain("17. 11.");
    expect(group.textContent).toContain("1 termin");
    expect(screen.getByText("Termini ne bodo prestavljeni.")).toBeTruthy();
    expect(screen.queryByTestId("roster-warning-usual-note")).toBeNull();
  });

  it.each([
    [1, "1 termin bo zunaj izmen"],
    [2, "2 termina bosta zunaj izmen"],
    [3, "3 termini bodo zunaj izmen"],
    [5, "5 terminov bo zunaj izmen"],
  ])("counts %i bookings in the plural form", (count, text) => {
    dialog({ warnings: [{ memberId: 2, outsideOpening: [], bookingsNewlyOutside: count }] });
    expect(screen.getByTestId("roster-warning-group-2").textContent).toContain(text);
  });

  it("a worker without bookings shows the days only, one without days the bookings only", () => {
    dialog({
      warnings: [
        { memberId: 2, outsideOpening: ["2026-11-17", "2026-11-18"], bookingsNewlyOutside: 0 },
        { memberId: 3, outsideOpening: [], bookingsNewlyOutside: 2 },
      ],
    });
    const ana = screen.getByTestId("roster-warning-group-2").textContent ?? "";
    expect(ana).toContain("17. 11.");
    expect(ana).toContain("18. 11.");
    expect(ana).not.toContain("termin");
    const bor = screen.getByTestId("roster-warning-group-3").textContent ?? "";
    expect(bor).toContain("2 termina");
    expect(bor).not.toContain("delovnega časa");
  });

  it("two workers are two groups in row order, whatever order the server answered in", () => {
    dialog({
      warnings: [
        { memberId: 3, outsideOpening: [], bookingsNewlyOutside: 1 },
        { memberId: 2, outsideOpening: ["2026-11-17"], bookingsNewlyOutside: 0 },
      ],
    });
    const groups = screen.getAllByTestId(/^roster-warning-group-/).map((g) => g.getAttribute("data-testid"));
    expect(groups).toEqual(["roster-warning-group-2", "roster-warning-group-3"]);
  });

  it("the usual week lists weekdays and repeats the planned-weeks note", () => {
    dialog({
      mode: "usual",
      warnings: [{ memberId: 2, outsideOpening: ["sat", "sun"], bookingsNewlyOutside: 3 }],
    });
    const text = screen.getByTestId("roster-warning-group-2").textContent ?? "";
    expect(text).toContain("sobota");
    expect(text).toContain("nedelja");
    expect(text).toContain("3 termini");
    expect(screen.getByTestId("roster-warning-usual-note").textContent).toBe(
      "Tedni s posebnim urnikom ostanejo nespremenjeni."
    );
  });

  it("„Vseeno shrani“ confirms", () => {
    dialog();
    fireEvent.click(screen.getByRole("button", { name: "Vseeno shrani" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("„Prekliči“ closes without confirming", () => {
    dialog();
    fireEvent.click(screen.getByRole("button", { name: "Prekliči" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("opens with „Prekliči“ focused, not „Vseeno shrani“ (final review UI-3)", () => {
    dialog();
    const d = screen.getByRole("dialog");
    expect(document.activeElement).toBe(within(d).getByRole("button", { name: "Prekliči" }));
  });
});
