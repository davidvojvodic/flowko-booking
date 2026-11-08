// Flowko U28: the hour axis, 24-hour labels in the business time zone; a 25-hour DST day has 25 labels.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { dayBounds } from "@calcom/lib/flowkoSalon";
import { hourRange } from "@calcom/lib/flowkoBusiness/desk";

import { HourAxis } from "./HourAxis";
import { TZ, at } from "./desk.fixture";

describe("HourAxis (U28 R14)", () => {
  it("labels every whole hour at its offset", () => {
    const range = hourRange(dayBounds("2026-11-16", TZ), TZ, [{ start: at("08:00"), end: at("10:30") }]);
    render(<HourAxis range={range} pxPerMinute={2} />);
    const hours = screen.getAllByTestId("desk-hour");
    expect(hours.map((h) => h.textContent)).toEqual(["08:00", "09:00", "10:00"]);
    expect(hours.map((h) => h.style.top)).toEqual(["0px", "120px", "240px"]);
  });

  it("draws 25 hours on the day the clocks go back", () => {
    const day = dayBounds("2026-10-25", TZ);
    const range = hourRange(day, TZ, [day]);
    render(<HourAxis range={range} pxPerMinute={1} />);
    const labels = screen.getAllByTestId("desk-hour").map((h) => h.textContent);
    expect(labels).toHaveLength(25);
    expect(labels.slice(0, 5)).toEqual(["00:00", "01:00", "02:00", "02:00", "03:00"]);
  });
});
