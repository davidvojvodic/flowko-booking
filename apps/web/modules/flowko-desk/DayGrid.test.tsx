// Flowko U28: the day grid: one column per worker in roster order, a locked column at the end, hour axis,
// now-line on today only, holiday banner.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DayGrid } from "./DayGrid";
import { ANA, BOR, CENE, DAN, DATE, NOW, OLGA, at, booking, deskView, iso, localeT } from "./desk.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const headers = () => screen.getAllByTestId(/^desk-column-header-/).map((h) => h.textContent);

function renderGrid(view = deskView(), date = DATE, onlyMemberId: number | null = null) {
  const onBook = vi.fn();
  const onOpenDetails = vi.fn();
  render(
    <DayGrid
      view={view}
      date={date}
      receivedAt={NOW.getTime()}
      onlyMemberId={onlyMemberId}
      onBook={onBook}
      onOpenDetails={onOpenDetails}
    />
  );
  return { onBook, onOpenDetails };
}

describe("DayGrid (U28)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders the columns in roster order, the locked one last and labelled, without a tap target", () => {
    renderGrid();
    expect(headers()).toEqual(["Olga", "Ana", "Bor", "Cene", "Dan (zaklenjeno)"]);
    for (const id of [OLGA, ANA, BOR, CENE]) {
      expect(screen.getByTestId(`desk-column-${id}`).getAttribute("data-tap")).toBe("book");
    }
    expect(screen.getByTestId(`desk-column-${DAN}`).getAttribute("data-tap")).toBeNull();
  });

  it("draws the hour axis over the union of opening, shifts and bookings (08:00-20:00)", () => {
    renderGrid();
    const labels = screen.getAllByTestId("desk-hour").map((h) => h.textContent);
    expect(labels[0]).toBe("08:00");
    expect(labels[labels.length - 1]).toBe("19:00");
    expect(labels).toHaveLength(12);
  });

  it("a tap in a column books that worker at that time", () => {
    const { onBook } = renderGrid();
    fireEvent.click(screen.getByTestId(`desk-column-${ANA}`), { clientY: ((at("09:30") - at("08:00")) / 60_000) * 2 });
    expect(onBook).toHaveBeenCalledWith({ memberId: ANA, start: at("09:30") });
  });

  it("shows the Google note only on the column whose Google calendar was not reachable", () => {
    renderGrid();
    expect(screen.getAllByText("Google koledar ni dosegljiv")).toHaveLength(1);
    expect(screen.getByTestId(`desk-column-${BOR}`).textContent).toContain("Google koledar ni dosegljiv");
  });

  it("draws the now-line at 08:07 on today", () => {
    renderGrid();
    const line = screen.getByTestId("desk-now-line");
    expect(line.style.top).toBe("14px");
    expect(line.textContent).toBe("08:07");
  });

  it("draws no now-line on another day", () => {
    renderGrid(deskView({}, "2026-11-17"), "2026-11-17");
    expect(screen.queryByTestId("desk-now-line")).toBeNull();
  });

  it("shades a past day entirely and books nothing there", () => {
    const { onBook } = renderGrid(deskView({}, "2026-11-13"), "2026-11-13");
    expect(screen.getByTestId(`desk-past-${ANA}`).style.height).toBe(`${12 * 60 * 2}px`);
    fireEvent.click(screen.getByTestId(`desk-column-${ANA}`), { clientY: 600 });
    expect(onBook).not.toHaveBeenCalled();
  });

  // Flowko U29e (E10.3, R19): the server sends the law's running-text form („dan reformacije“); the label starts
  // with a capital.
  it("shows a holiday banner", () => {
    renderGrid(deskView({ holiday: { name: "dan reformacije", open: false } }));
    expect(screen.getByTestId("desk-holiday").textContent).toBe("Dan reformacije – zaprto");
  });

  it("capitalises the server's holiday name: „božič“ → „Božič – zaprto“, open → „Božič – odprto“", () => {
    renderGrid(deskView({ holiday: { name: "božič", open: false } }));
    expect(screen.getByTestId("desk-holiday").textContent).toBe("Božič – zaprto");
    cleanup();
    renderGrid(deskView({ holiday: { name: "božič", open: true } }));
    expect(screen.getByTestId("desk-holiday").textContent).toBe("Božič – odprto");
  });

  // Flowko U29e (E10.1): a locked column header names „Ana & Maja“ once.
  it("a locked column header shows its name once", () => {
    const view = deskView();
    view.days[0].columns = view.days[0].columns.map((c) =>
      c.memberId === DAN ? { ...c, displayName: "Ana & Maja" } : c
    );
    renderGrid(view);
    expect(screen.getByTestId(`desk-column-header-${DAN}`).textContent).toBe("Ana & Maja (zaklenjeno)");
  });

  it("shows only one column when asked (phone)", () => {
    renderGrid(deskView(), DATE, BOR);
    expect(headers()).toEqual(["Bor"]);
    expect(screen.getByTestId("desk-booking-102")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-booking-101")).toBeNull();
  });

  // Flowko U28b (B4): the sticky hour column and header (z-40/z-50) stay inside the grid's own stacking context,
  // so on a phone they never paint over the shell's fixed bottom navigation (z-30).
  it("keeps the sticky hour column inside the grid's own stacking context, below the mobile nav (B4)", () => {
    renderGrid();
    const scroll = screen.getByTestId("desk-grid-scroll");
    expect(scroll.classList.contains("isolate")).toBe(true);
    expect(Array.from(scroll.classList).some((c) => /^z-/.test(c))).toBe(false);
    const axis = screen.getAllByTestId("desk-hour")[0].closest(".sticky") as HTMLElement;
    expect(axis).not.toBeNull();
    expect(scroll.contains(axis)).toBe(true);
  });
});

// Flowko U29f: F2, R8 — each worker column counts its own live bookings, so every column starts at tone a.
describe("DayGrid tones (U29f F2)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("Olga's and Ana's first bookings at 09:00 are both a; Ana's second is b", () => {
    const view = deskView();
    view.days[0].bookings = [
      ...view.days[0].bookings,
      booking({ bookingId: 110, memberId: OLGA, start: iso("09:00"), end: iso("09:30") }),
      booking({ bookingId: 111, memberId: ANA, start: iso("11:00"), end: iso("11:30") }),
    ];
    renderGrid(view);
    const tone = (id: number) => screen.getByTestId(`desk-booking-${id}`).dataset.tone;
    expect([tone(110), tone(101), tone(111), tone(102)]).toEqual(["a", "a", "b", "a"]);
  });
});
