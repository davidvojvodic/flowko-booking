// Flowko U29a: the opening-hours editor (S16): per weekday from–to rows with 24-hour selects in 15-minute steps
// from 03:00 to 24:00, „Dodaj“ / remove per row, „Zaprto“ when a day is empty, „Kopiraj na vse dni“ from Monday,
// the day's error text under its row. Controlled: every edit is one onChange with the whole week.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DayRangesEditor, TIME_OPTIONS } from "./DayRangesEditor";
import { localeT, OPENING } from "./settings.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const select = (testId: string) => screen.getByTestId(testId) as HTMLSelectElement;

function setup(value = OPENING, dayErrors?: Record<string, string>) {
  const onChange = vi.fn();
  render(<DayRangesEditor value={value} onChange={onChange} dayErrors={dayErrors} />);
  return onChange;
}

describe("DayRangesEditor (U29a S16)", () => {
  it("offers 03:00 to 24:00 in 15-minute steps", () => {
    expect(TIME_OPTIONS[0]).toBe("03:00");
    expect(TIME_OPTIONS[1]).toBe("03:15");
    expect(TIME_OPTIONS[TIME_OPTIONS.length - 1]).toBe("24:00");
    expect(TIME_OPTIONS).toHaveLength(21 * 4 + 1);
  });

  it("shows every weekday with its ranges, and „Zaprto“ on an empty day", () => {
    setup();
    for (const day of ["ponedeljek", "torek", "sreda", "četrtek", "petek", "sobota", "nedelja"]) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
    expect(select("flowko-day-ranges-mon-0-from").value).toBe("08:00");
    expect(select("flowko-day-ranges-mon-0-to").value).toBe("20:00");
    expect(select("flowko-day-ranges-sat-0-to").value).toBe("13:00");
    expect(screen.getByTestId("flowko-day-ranges-sun-closed")).toHaveTextContent("Zaprto");
    expect(screen.queryByTestId("flowko-day-ranges-mon-closed")).toBeNull();
  });

  it("a time changed in a select is one onChange with the whole week", () => {
    const onChange = setup();
    fireEvent.change(select("flowko-day-ranges-tue-0-from"), { target: { value: "09:30" } });
    expect(onChange).toHaveBeenCalledWith({ ...OPENING, tue: [{ from: "09:30", to: "20:00" }] });
  });

  it("„Dodaj“ on a closed day adds 08:00–16:00; on an open day it continues after the last range", () => {
    const onChange = setup({ ...OPENING, sat: [{ from: "08:00", to: "12:00" }] });
    fireEvent.click(screen.getByTestId("flowko-day-ranges-sun-add"));
    expect(onChange).toHaveBeenLastCalledWith({
      ...OPENING,
      sat: [{ from: "08:00", to: "12:00" }],
      sun: [{ from: "08:00", to: "16:00" }],
    });
    fireEvent.click(screen.getByTestId("flowko-day-ranges-sat-add"));
    expect(onChange).toHaveBeenLastCalledWith({
      ...OPENING,
      sat: [
        { from: "08:00", to: "12:00" },
        { from: "12:00", to: "13:00" },
      ],
    });
  });

  it("„Dodaj“ is off on a day that already runs to 24:00", () => {
    setup({ ...OPENING, fri: [{ from: "20:00", to: "24:00" }] });
    expect(screen.getByTestId("flowko-day-ranges-fri-add")).toBeDisabled();
    expect(screen.getByTestId("flowko-day-ranges-thu-add")).not.toBeDisabled();
  });

  it("removing the only range closes the day", () => {
    const onChange = setup();
    fireEvent.click(screen.getByTestId("flowko-day-ranges-sat-0-remove"));
    expect(onChange).toHaveBeenCalledWith({ ...OPENING, sat: [] });
  });

  it("„Kopiraj na vse dni“ copies Monday to every other day", () => {
    const monday = [
      { from: "07:00", to: "12:00" },
      { from: "13:00", to: "19:00" },
    ];
    const onChange = setup({ ...OPENING, mon: monday });
    fireEvent.click(screen.getByText("Kopiraj na vse dni"));
    expect(onChange).toHaveBeenCalledWith({
      mon: monday,
      tue: monday,
      wed: monday,
      thu: monday,
      fri: monday,
      sat: monday,
      sun: monday,
    });
    // copies, not shared references (a later edit of one day must not change the others)
    const week = onChange.mock.calls[0][0];
    expect(week.tue).not.toBe(week.mon);
    expect(week.tue[0]).not.toBe(week.mon[0]);
  });

  it("a stored time off the 15-minute grid still shows as the selected value", () => {
    setup({ ...OPENING, wed: [{ from: "08:10", to: "19:50" }] });
    expect(select("flowko-day-ranges-wed-0-from").value).toBe("08:10");
    expect(select("flowko-day-ranges-wed-0-to").value).toBe("19:50");
  });

  it("shows a day's error under its row", () => {
    setup(OPENING, { tue: "Konec mora biti za začetkom." });
    expect(screen.getByTestId("flowko-day-ranges-tue-error")).toHaveTextContent(
      "Konec mora biti za začetkom."
    );
    expect(screen.queryByTestId("flowko-day-ranges-mon-error")).toBeNull();
  });

  it("names each select for screen readers by its weekday", () => {
    setup();
    expect(screen.getByLabelText("ponedeljek: od")).toBe(select("flowko-day-ranges-mon-0-from"));
    expect(screen.getByLabelText("ponedeljek: do")).toBe(select("flowko-day-ranges-mon-0-to"));
  });
});
