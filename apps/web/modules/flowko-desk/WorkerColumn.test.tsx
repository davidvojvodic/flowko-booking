// Flowko U28: one worker's column of the day view: bands, other busy time, bookings in lanes, tap to book.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DeskBooking, DeskColumn } from "@calcom/features/flowkoBusiness/desk";
import { dayBounds } from "@calcom/lib/flowkoSalon";

import { WorkerColumn } from "./WorkerColumn";
import { ANA, BOR, DAN, DATE, OLGA, TZ, at, barvanje, booking, deskView, iso, localeT } from "./desk.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const day = dayBounds(DATE, TZ);
const range = { from: at("08:00"), to: at("20:00") };
const PX = 2;
const yOf = (hm: string) => ((at(hm) - range.from) / 60_000) * PX;
const view = deskView();
const columnOf = (memberId: number) => view.days[0].columns.find((c) => c.memberId === memberId) as DeskColumn;

function renderColumn(
  memberId: number,
  bookings: DeskBooking[],
  opts: { pastUntil?: number; column?: Partial<DeskColumn> } = {}
) {
  const onBook = vi.fn();
  const onOpenDetails = vi.fn();
  render(
    <WorkerColumn
      column={{ ...columnOf(memberId), ...opts.column }}
      bookings={bookings}
      day={day}
      opening={view.days[0].opening}
      range={range}
      pxPerMinute={PX}
      timeZone={TZ}
      stepMinutes={15}
      pastUntil={opts.pastUntil ?? at("08:00")}
      onBook={onBook}
      onOpenDetails={onOpenDetails}
    />
  );
  return { onBook, onOpenDetails, body: screen.getByTestId(`desk-column-${memberId}`) };
}

describe("WorkerColumn tap to book (U28 R10)", () => {
  it("a tap at 09:30 in Ana's colouring gap books 09:30 (RF2)", () => {
    const { onBook, body } = renderColumn(ANA, [barvanje]);
    fireEvent.click(body, { clientY: yOf("09:30") + 1 });
    expect(onBook).toHaveBeenCalledWith({ memberId: ANA, start: at("09:30") });
  });

  it("a tap at 10:42, just under the colouring that ends 10:40, books 10:40", () => {
    const { onBook, body } = renderColumn(ANA, [barvanje]);
    fireEvent.click(body, { clientY: yOf("10:42") });
    expect(onBook).toHaveBeenCalledWith({ memberId: ANA, start: at("10:40") });
  });

  it("a tap before the current slot does nothing", () => {
    const { onBook, body } = renderColumn(ANA, [barvanje], { pastUntil: at("11:00") });
    fireEvent.click(body, { clientY: yOf("10:50") });
    expect(onBook).not.toHaveBeenCalled();
    fireEvent.click(body, { clientY: yOf("11:05") });
    expect(onBook).toHaveBeenCalledWith({ memberId: ANA, start: at("11:00") });
    expect(screen.getByTestId(`desk-past-${ANA}`).style.height).toBe(`${yOf("11:00")}px`);
  });

  it("a locked column has no tap target, but its booking still opens the details", () => {
    const dan = view.days[0].bookings.find((b) => b.memberId === DAN) as DeskBooking;
    const { onBook, onOpenDetails, body } = renderColumn(DAN, [dan]);
    expect(body.getAttribute("data-tap")).toBeNull();
    fireEvent.click(body, { clientY: yOf("09:00") });
    expect(onBook).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("desk-booking-103").querySelector('[data-kind="busy"]') as HTMLElement);
    expect(onOpenDetails).toHaveBeenCalledWith(103);
  });
});

describe("WorkerColumn lanes (U28 R14, RF7)", () => {
  const first = booking({ bookingId: 104, memberId: ANA, start: iso("11:00"), end: iso("12:00") });
  const second = booking({ bookingId: 105, memberId: ANA, start: iso("11:30"), end: iso("12:30") });
  const inGap = booking({ bookingId: 106, memberId: ANA, start: iso("09:30"), end: iso("10:00") });

  it("two overlapping busy blocks sit side by side and both open their details", () => {
    const { onOpenDetails, onBook } = renderColumn(ANA, [barvanje, first, second, inGap]);
    const a = screen.getByTestId("desk-booking-104");
    const b = screen.getByTestId("desk-booking-105");
    expect(a.style.left).not.toBe(b.style.left);
    expect([a.style.width, b.style.width]).toEqual(["50%", "50%"]);
    fireEvent.click(a.querySelector('[data-kind="busy"]') as HTMLElement);
    fireEvent.click(b.querySelector('[data-kind="busy"]') as HTMLElement);
    expect(onOpenDetails.mock.calls).toEqual([[104], [105]]);
    expect(onBook).not.toHaveBeenCalled();
  });

  it("a booking inside the colouring's processing gap keeps full width", () => {
    renderColumn(ANA, [barvanje, first, second, inGap]);
    const gap = screen.getByTestId("desk-booking-106");
    expect(gap.style.left).toBe("0%");
    expect(gap.style.width).toBe("100%");
    expect(screen.getByTestId("desk-booking-101").style.width).toBe("100%");
    // drawn over the colouring, so its busy segment is the one a finger hits
    expect(Number(gap.style.zIndex)).toBeGreaterThan(Number(screen.getByTestId("desk-booking-101").style.zIndex));
  });
});

describe("WorkerColumn backgrounds (U28 R3, R14)", () => {
  const bands = (memberId: number) =>
    Array.from(screen.getByTestId(`desk-column-${memberId}`).querySelectorAll<HTMLElement>("[data-band]")).map(
      (b) => b.dataset.band
    );

  it("shift, time off, off shift and closed bands, clipped to the visible hours", () => {
    renderColumn(ANA, []);
    expect(bands(ANA)).toEqual(["shift", "time_off", "shift", "off_shift", "closed"]);
    const timeOff = screen.getByTestId(`desk-column-${ANA}`).querySelector('[data-band="time_off"]') as HTMLElement;
    expect(timeOff.style.top).toBe(`${yOf("14:00")}px`);
    expect(timeOff.style.height).toBe("120px");
    expect(timeOff.textContent).toBe("Odsotnost");
  });

  it("other busy time is a „Zasedeno“ block with no title", () => {
    renderColumn(OLGA, []);
    const busy = screen.getAllByTestId("desk-other-busy");
    expect(busy).toHaveLength(1);
    expect(busy[0].textContent).toBe("Zasedeno");
    expect(busy[0].style.top).toBe(`${yOf("12:00")}px`);
    expect(busy[0].style.height).toBe("120px");
  });

  it("other busy time is clipped to the visible hours", () => {
    renderColumn(OLGA, [], { column: { otherBusy: [{ start: at("06:00"), end: at("08:30") }] } });
    const busy = screen.getByTestId("desk-other-busy");
    expect(busy.style.top).toBe("0px");
    expect(busy.style.height).toBe("60px");
  });

  it("a Google-unavailable column keeps its shift bands under a hatched overlay with the note", () => {
    renderColumn(BOR, []);
    expect(bands(BOR)).toEqual(["off_shift", "shift", "closed"]);
    const overlay = screen.getByTestId(`desk-google-unavailable-${BOR}`);
    expect(overlay.style.pointerEvents).toBe("none");
    // the hatch itself is an inline repeating-linear-gradient, which jsdom's CSS parser drops
    expect(overlay.dataset.pattern).toBe("hatched");
    expect(overlay.textContent).toBe("Google koledar ni dosegljiv");
    expect(screen.queryByTestId(`desk-google-unavailable-${ANA}`)).toBeNull();
  });
});
