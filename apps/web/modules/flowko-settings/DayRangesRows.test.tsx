// Flowko U29b (S12): one day's from–to rows, shared by the opening-hours editor and Urnik's cell editor: the
// caller's empty text and add labels, the row cap (`maxRows`), the error tied to the selects, controlled onChange.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DayRangesRows } from "./DayRangesEditor";
import { localeT } from "./settings.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const s = (from: string, to: string) => ({ from, to });

function setup(value: Array<{ from: string; to: string }>, over: { maxRows?: number; error?: string } = {}) {
  const onChange = vi.fn();
  render(
    <DayRangesRows
      value={value}
      onChange={onChange}
      dayLabel="torek"
      addLabel="Dodaj izmeno"
      addAriaLabel="Dodaj izmeno: torek"
      emptyLabel="Prosto"
      maxRows={over.maxRows}
      error={over.error}
      errorId="cell-error"
      testIdPrefix="roster-cell"
    />
  );
  return onChange;
}

describe("DayRangesRows (U29b S12)", () => {
  afterEach(cleanup);

  it("an empty day shows the caller's empty text; the add button carries the caller's labels", () => {
    const onChange = setup([]);
    expect(screen.getByTestId("roster-cell-closed")).toHaveTextContent("Prosto");
    const add = screen.getByRole("button", { name: "Dodaj izmeno: torek" });
    expect(add).toHaveTextContent("Dodaj izmeno");
    fireEvent.click(add);
    expect(onChange).toHaveBeenCalledWith([s("08:00", "16:00")]);
  });

  it("edits, adds after the last row and removes, each as one onChange with the day's rows", () => {
    const onChange = setup([s("08:00", "12:00")]);
    fireEvent.change(screen.getByLabelText("torek: do"), { target: { value: "13:00" } });
    expect(onChange).toHaveBeenLastCalledWith([s("08:00", "13:00")]);
    fireEvent.click(screen.getByTestId("roster-cell-add"));
    expect(onChange).toHaveBeenLastCalledWith([s("08:00", "12:00"), s("12:00", "13:00")]);
    fireEvent.click(screen.getByTestId("roster-cell-0-remove"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("the add button is off at maxRows rows", () => {
    const four = [s("08:00", "09:00"), s("10:00", "11:00"), s("12:00", "13:00"), s("14:00", "15:00")];
    setup(four, { maxRows: 4 });
    expect(screen.getByTestId("roster-cell-add")).toBeDisabled();
    cleanup();
    setup(four.slice(0, 3), { maxRows: 4 });
    expect(screen.getByTestId("roster-cell-add")).not.toBeDisabled();
  });

  it("the error is shown under the rows and describes the selects by the given id", () => {
    setup([s("12:00", "08:00")], { error: "Napačen čas" });
    expect(screen.getByRole("alert")).toHaveAttribute("id", "cell-error");
    expect(screen.getByLabelText("torek: od")).toHaveAttribute("aria-describedby", "cell-error");
    expect(screen.getByLabelText("torek: od")).toHaveAttribute("aria-invalid", "true");
  });
});
