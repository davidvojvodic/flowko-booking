// Flowko U28: the override dialog (R7, R8): one Slovene line per problem with the step's service name and the
// conflicting time, the Google line instead of calendar overlaps, „Vseeno shrani“ confirms.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProblemsDialog, problemLines, stepNamesOf } from "./ConfirmProblemsDialog";
import { TZ, at, localeT, services } from "./desk.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const t = localeT("sl");
// Moško striženje (1 step) then Barvanje (3 steps): step 0 = Moško, steps 1-3 = Barvanje.
const names = stepNamesOf([services[1], services[0]]);

describe("ConfirmProblemsDialog (U28 R8)", () => {
  it("names each step by its service in tap order", () => {
    expect(names).toEqual(["Moško striženje", "Barvanje", "Barvanje", "Barvanje"]);
  });

  it("maps every problem kind to its line", () => {
    const lines = problemLines(
      [
        { kind: "outside_opening" },
        { kind: "off_grid" },
        { kind: "too_soon" },
        { kind: "outside_shift", step: 3 },
        { kind: "time_off", step: 1, with: { start: at("14:00"), end: at("15:00") } },
        { kind: "overlaps_booking", step: 0, with: { start: at("09:30"), end: at("10:00") } },
        { kind: "overlaps_external", step: 2, with: { start: at("12:00"), end: at("13:00") } },
      ],
      false,
      names,
      TZ,
      t
    );
    expect(lines).toEqual([
      "Zunaj delovnega časa.",
      "Začetek ni na mreži terminov.",
      "Manj vnaprej, kot dovoljujejo pravila rezervacij.",
      "Barvanje: zunaj izmene delavca.",
      "Barvanje: delavec je odsoten 14:00–15:00.",
      "Moško striženje: prekriva se s terminom 09:30–10:00.",
      "Barvanje: prekriva se z zasedenostjo v koledarju 12:00–13:00.",
    ]);
  });

  it("shows the Google line once instead of calendar overlaps when Google is unavailable", () => {
    const lines = problemLines(
      [
        { kind: "overlaps_external", step: 0, with: { start: at("00:00"), end: at("23:59") } },
        { kind: "overlaps_external", step: 1, with: { start: at("00:00"), end: at("23:59") } },
        { kind: "overlaps_booking", step: 1, with: { start: at("10:10"), end: at("10:40") } },
      ],
      true,
      names,
      TZ,
      t
    );
    expect(lines).toEqual([
      "Barvanje: prekriva se s terminom 10:10–10:40.",
      "Google koledar trenutno ni dosegljiv",
    ]);
  });

  it("drops duplicate lines and falls back to the given name for an unknown step", () => {
    const overlap = {
      kind: "overlaps_booking" as const,
      step: 9,
      with: { start: at("10:10"), end: at("10:40") },
    };
    expect(problemLines([overlap, overlap], false, names, TZ, t, "Barvanje")).toEqual([
      "Barvanje: prekriva se s terminom 10:10–10:40.",
    ]);
  });

  it("lists the lines and confirms with „Vseeno shrani“", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmProblemsDialog
        open
        problems={[{ kind: "overlaps_booking", step: 0, with: { start: at("09:30"), end: at("10:00") } }]}
        googleUnavailable={false}
        stepNames={names}
        timeZone={TZ}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    expect(screen.getByText("Termin ni v skladu s pravili")).toBeInTheDocument();
    expect(screen.getAllByTestId("desk-problem").map((l) => l.textContent)).toEqual([
      "Moško striženje: prekriva se s terminom 09:30–10:00.",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Vseeno shrani" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("cancel closes without confirming", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmProblemsDialog
        open
        problems={[{ kind: "off_grid" }]}
        googleUnavailable={false}
        stepNames={names}
        timeZone={TZ}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Prekliči" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
