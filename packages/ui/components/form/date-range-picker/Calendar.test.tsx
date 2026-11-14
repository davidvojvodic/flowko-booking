// Flowko U29f: range pickers get the brand selected day too (R1 amended): start and end in the
// brand pair, the days between in a readable pair (#1A1A2E on #E8E0F5 = 13.33:1 light,
// #FAFAFA on #404040 = 9.93:1 dark), never Cal's near-black bg-inverted.
import { render, screen } from "@testing-library/react";

import { DatePickerWithRange } from "./DateRangePicker";

function classTokens(el: Element) {
  return el.getAttribute("class")?.split(/\s+/) ?? [];
}

function dayButton(day: string) {
  const cells = screen
    .getAllByRole("gridcell")
    .filter((c) => c.textContent === day && c.getAttribute("aria-selected") === "true");
  expect(cells).toHaveLength(1);
  return cells[0];
}

describe("Flowko U29f: range picker selected days", () => {
  function renderRange() {
    render(
      <DatePickerWithRange
        withoutPopover
        allowPastDates
        minDate={null}
        dates={{ startDate: new Date(2026, 11, 7), endDate: new Date(2026, 11, 10) }}
        onDatesChange={() => {}}
      />
    );
  }

  test("start and end days carry the brand pair, never bg-inverted", () => {
    renderRange();

    for (const day of ["7", "10"]) {
      const tokens = classTokens(dayButton(day));
      expect(tokens).toContain("bg-brand-default!");
      expect(tokens).toContain("text-brand!");
      expect(tokens).not.toContain("bg-inverted");
      expect(tokens).not.toContain("text-inverted!");
      expect(tokens).not.toContain("hover:bg-inverted!");
    }
  });

  test("days between keep a readable pair that beats the brand pair", () => {
    renderRange();

    for (const day of ["8", "9"]) {
      const tokens = classTokens(dayButton(day));
      expect(tokens).toContain("aria-selected:bg-emphasis!");
      expect(tokens).toContain("aria-selected:text-emphasis!");
      // Flowko U29f: final-review SCOPE-1 — hover still lightens a middle day (important 0,3,0 beats the pair).
      expect(tokens).toContain("not-disabled:hover:bg-subtle!");
      expect(tokens).not.toContain("bg-inverted");
    }
  });
});
