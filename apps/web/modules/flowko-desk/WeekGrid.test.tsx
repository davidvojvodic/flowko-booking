// Flowko U28: the week grid: one worker x seven days, Monday first, one shared hour axis, taps per day.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeskView } from "@calcom/features/flowkoBusiness/desk";

import { WeekGrid, mondayOf, weekRanges } from "./WeekGrid";
import { ANA, DATE, NOW, at, deskView, iso, localeT, weekViewOf, wednesdayCut } from "./desk.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));

const yOf = (hm: string, date: string) => ((at(hm, date) - at("08:00", date)) / 60_000) * 2;
const column = (date: string) => screen.getByTestId(`desk-column-${date}`);

function renderWeek(view: DeskView = weekViewOf(ANA), over: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  const onBook = vi.fn();
  const onOpenDetails = vi.fn();
  const onOpenDay = vi.fn();
  render(
    <WeekGrid
      view={view}
      receivedAt={NOW.getTime()}
      onBook={onBook}
      onOpenDetails={onOpenDetails}
      onOpenDay={onOpenDay}
      {...over}
    />
  );
  return { onBook, onOpenDetails, onOpenDay };
}

describe("mondayOf (U28 D2)", () => {
  it("is the Monday of the business-local date's week, Sunday included", () => {
    expect(mondayOf("2026-11-16")).toBe("2026-11-16");
    expect(mondayOf("2026-11-18")).toBe("2026-11-16");
    expect(mondayOf("2026-11-22")).toBe("2026-11-16");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });
});

describe("WeekGrid (U28)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("draws seven day columns, Monday to Sunday, with that worker's bands and blocks", () => {
    renderWeek();
    const headers = screen.getAllByTestId(/^desk-week-header-/);
    expect(headers.map((h) => h.getAttribute("data-testid"))).toEqual(
      ["16", "17", "18", "19", "20", "21", "22"].map((d) => `desk-week-header-2026-11-${d}`)
    );
    expect(headers[0].textContent).toMatch(/pon/i);
    expect(headers[6].textContent).toMatch(/ned/i);
    expect(screen.getAllByTestId(/^desk-column-2026-/)).toHaveLength(7);
    // Ana's Barvanje on Monday, her cut on Wednesday, nothing else
    expect(within(column(DATE)).getByTestId("desk-booking-101")).toBeInTheDocument();
    expect(within(column("2026-11-18")).getByTestId("desk-booking-201")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^desk-booking-/)).toHaveLength(2);
    // Ana's time off 14:00-15:00 on each day, and Olga's / Bor's columns are not drawn
    expect(screen.getAllByText("Odsotnost")).toHaveLength(7);
    expect(screen.queryByText("Olga")).toBeNull();
  });

  it("draws the busy segment and the see-through processing segment of a booking", () => {
    renderWeek();
    const block = screen.getByTestId("desk-booking-101");
    expect(block.querySelectorAll('[data-kind="busy"]')).toHaveLength(2);
    expect(block.querySelectorAll('[data-kind="processing"]')).toHaveLength(1);
  });

  it("uses one hour axis over the union of the seven days (a late booking widens every day)", () => {
    const view = weekViewOf(ANA);
    view.days[3].bookings = [
      { ...wednesdayCut, bookingId: 301, start: iso("19:00", "2026-11-19"), end: iso("20:30", "2026-11-19") },
    ];
    renderWeek(view);
    const labels = screen.getAllByTestId("desk-hour").map((h) => h.textContent);
    expect(labels[0]).toBe("08:00");
    expect(labels[labels.length - 1]).toBe("20:00");
    const heights = screen.getAllByTestId(/^desk-column-2026-/).map((c) => (c as HTMLElement).style.height);
    expect(new Set(heights).size).toBe(1);
  });

  it("an early shift on one day widens the axis for all days", () => {
    const view = weekViewOf(ANA);
    view.days[4].columns[0].shifts = [{ start: at("06:30", "2026-11-20"), end: at("12:00", "2026-11-20") }];
    renderWeek(view);
    expect(screen.getAllByTestId("desk-hour")[0].textContent).toBe("06:00");
  });

  it("a tap on a day header opens that day", () => {
    const { onOpenDay } = renderWeek();
    fireEvent.click(screen.getByTestId("desk-week-header-2026-11-19"));
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-19");
  });

  it("a tap on an empty spot books that worker on that day", () => {
    const { onBook } = renderWeek();
    fireEvent.click(column("2026-11-18"), { clientY: yOf("11:30", "2026-11-18") });
    expect(onBook).toHaveBeenCalledWith({ memberId: ANA, start: at("11:30", "2026-11-18") });
  });

  it("a tap just after a booking books the free time right after it, on a later day", () => {
    const { onBook } = renderWeek();
    fireEvent.click(column("2026-11-18"), { clientY: yOf("10:42", "2026-11-18") });
    expect(onBook).toHaveBeenCalledWith({ memberId: ANA, start: at("10:30", "2026-11-18") });
  });

  it("past days take no taps; today's past slots neither", () => {
    const { onBook } = renderWeek(weekViewOf(ANA, "2026-11-09"));
    fireEvent.click(column("2026-11-11"), { clientY: yOf("11:30", "2026-11-11") });
    expect(onBook).not.toHaveBeenCalled();
  });

  it("shows the now-line on today's column only", () => {
    renderWeek();
    const lines = screen.getAllByTestId("desk-now-line");
    expect(lines).toHaveLength(1);
    expect(column(DATE).parentElement?.contains(lines[0])).toBe(true);
    expect(screen.getByTestId(`desk-week-header-${DATE}`)).toHaveAttribute("data-today", "true");
  });

  it("no now-line in another week", () => {
    renderWeek(weekViewOf(ANA, "2026-11-23"));
    expect(screen.queryByTestId("desk-now-line")).toBeNull();
  });

  it("a locked worker's week takes no taps; canBook=false neither", () => {
    const view = weekViewOf(ANA);
    view.days.forEach((d) => {
      d.columns[0].locked = true;
    });
    const { onBook } = renderWeek(view);
    expect(column(DATE)).not.toHaveAttribute("data-tap");
    fireEvent.click(column("2026-11-18"), { clientY: yOf("11:30", "2026-11-18") });
    expect(onBook).not.toHaveBeenCalled();
    cleanup();
    const second = renderWeek(weekViewOf(ANA), { canBook: () => false });
    expect(column("2026-11-18")).not.toHaveAttribute("data-tap");
    fireEvent.click(column("2026-11-18"), { clientY: yOf("11:30", "2026-11-18") });
    expect(second.onBook).not.toHaveBeenCalled();
  });

  it("dims every day while another worker's booking is being moved", () => {
    renderWeek(weekViewOf(ANA), { movingMemberId: 3 });
    expect(column(DATE)).toHaveAttribute("data-dimmed", "true");
    cleanup();
    renderWeek(weekViewOf(ANA), { movingMemberId: ANA });
    expect(column(DATE)).not.toHaveAttribute("data-dimmed");
  });

  // Flowko U29e (E10.3, R19): the server's running-text name starts the label with a capital.
  it("labels a holiday under its day", () => {
    const view = weekViewOf(ANA);
    view.days[2].holiday = { name: "dan reformacije", open: false };
    renderWeek(view);
    expect(screen.getByTestId("desk-week-header-2026-11-18").textContent).toContain("Dan reformacije");
    expect(screen.getByTestId("desk-week-header-2026-11-18").textContent).not.toContain("dan reformacije");
  });

  it("a booking tap opens its details", () => {
    const { onOpenDetails } = renderWeek();
    fireEvent.click(
      screen.getByTestId("desk-booking-201").querySelector('[data-kind="busy"]') as HTMLElement
    );
    expect(onOpenDetails).toHaveBeenCalledWith(201);
  });
});

describe("weekRanges (U28 R14)", () => {
  it("gives the same whole hours to the seven days of a week with a 25 h Sunday", () => {
    const base = deskView();
    const days = [
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ].map((date) => ({ ...deskView({}, date).days[0], bookings: [] }));
    const ranges = weekRanges({ ...base, days });
    expect(ranges).toHaveLength(7);
    // opening 08-19, shifts to 20:00: 08:00-20:00 every day, DST Sunday included (12 hours)
    expect(ranges.map((r) => r.range.hours.length)).toEqual([12, 12, 12, 12, 12, 12, 12]);
    expect(ranges.map((r) => r.range.hours[0].label)).toEqual(Array(7).fill("08:00"));
  });

  it("falls back to 08-18 for a week with nothing in it", () => {
    const base = deskView();
    const days = [
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ].map((date) => ({ ...deskView({}, date).days[0], opening: [], columns: [], bookings: [] }));
    const ranges = weekRanges({ ...base, days });
    expect(ranges[0].range.hours.map((h) => h.label)).toEqual(
      ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17"].map((h) => `${h}:00`)
    );
  });
});

describe("WeekGrid stacking (U28b B4)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("keeps the sticky hour column inside the grid's own stacking context, below the mobile nav", () => {
    renderWeek();
    const scroll = screen.getByTestId("desk-grid-scroll");
    expect(scroll.classList.contains("isolate")).toBe(true);
    expect(Array.from(scroll.classList).some((c) => /^z-/.test(c))).toBe(false);
    const axis = screen.getAllByTestId("desk-hour")[0].closest(".sticky") as HTMLElement;
    expect(scroll.contains(axis)).toBe(true);
  });
});
