// Flowko U29a: the narrower-opening dialog (S3): the two counts as plural lines (shift days, bookings), nothing is
// moved; „Vseeno shrani“ confirms, „Prekliči“ closes without confirming.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutsideOpeningDialog } from "./OutsideOpeningDialog";
import { localeT } from "./settings.fixture";

const lang = vi.hoisted(() => ({ current: "sl" as "sl" | "en" }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT(lang.current) }) }));

function setup(shifts: number, bookings: number) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <OutsideOpeningDialog open outside={{ shifts, bookings }} onConfirm={onConfirm} onClose={onClose} />
  );
  return { onConfirm, onClose };
}

const lines = () => screen.getAllByTestId("flowko-settings-outside-line").map((li) => li.textContent);

describe("OutsideOpeningDialog (U29a S3)", () => {
  it.each([
    [1, 1, ["1 dan z izmeno", "1 termin"]],
    [2, 2, ["2 dneva z izmeno", "2 termina"]],
    [3, 4, ["3 dnevi z izmeno", "4 termini"]],
    [5, 21, ["5 dni z izmeno", "21 terminov"]],
  ])("sl: %i shift days and %i bookings", (shifts, bookings, expected) => {
    lang.current = "sl";
    setup(shifts, bookings);
    expect(lines()).toEqual(expected);
    expect(
      screen.getByText("Izmene in termini ostanejo, kot so. Preverite jih na koledarju.")
    ).toBeInTheDocument();
  });

  it.each([
    [1, 1, ["1 day with a shift", "1 booking"]],
    [2, 3, ["2 days with a shift", "3 bookings"]],
  ])("en: %i shift days and %i bookings", (shifts, bookings, expected) => {
    lang.current = "en";
    setup(shifts, bookings);
    expect(lines()).toEqual(expected);
  });

  it("a zero count has no line", () => {
    lang.current = "sl";
    setup(0, 3);
    expect(lines()).toEqual(["3 termini"]);
  });

  it("„Vseeno shrani“ confirms", () => {
    lang.current = "sl";
    const { onConfirm } = setup(1, 0);
    fireEvent.click(screen.getByRole("button", { name: "Vseeno shrani" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("„Prekliči“ closes without confirming", () => {
    lang.current = "sl";
    const { onConfirm, onClose } = setup(1, 0);
    fireEvent.click(screen.getByRole("button", { name: "Prekliči" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
