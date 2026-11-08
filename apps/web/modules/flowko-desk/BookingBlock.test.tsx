// Flowko U28: one booking block. A colouring is drawn from its steps; the processing gap is see-through to taps.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BookingBlock } from "./BookingBlock";
import { TZ, at, barvanje, booking, localeT } from "./desk.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const range = { from: at("08:00"), to: at("19:00") };

function renderBlock(
  b = barvanje,
  onOpenDetails = vi.fn(),
  opts: { passThrough?: boolean; onParent?: () => void } = {}
) {
  render(
    <div style={{ position: "relative" }} onClick={opts.onParent}>
      <BookingBlock
        booking={b}
        range={range}
        pxPerMinute={2}
        timeZone={TZ}
        lane={0}
        lanes={1}
        zIndex={10}
        onOpenDetails={onOpenDetails}
        passThrough={opts.passThrough}
      />
    </div>
  );
  return onOpenDetails;
}

describe("BookingBlock (U28)", () => {
  it("draws a colouring as three segments; the processing one lets taps through", () => {
    renderBlock();
    const block = screen.getByTestId("desk-booking-101");
    const segments = Array.from(block.querySelectorAll<HTMLElement>("[data-kind]"));
    expect(segments.map((s) => s.dataset.kind)).toEqual(["busy", "processing", "busy"]);
    expect(segments[1].style.pointerEvents).toBe("none");
    expect(segments[1].dataset.pattern).toBe("hatched");
    expect(block.style.pointerEvents).toBe("none");
    expect(segments[0].style.pointerEvents).not.toBe("none");
    // 09:00 is 120 px under 08:00 at 2 px a minute; the block is 100 min tall; the gap starts 60 px into it.
    expect(block.style.top).toBe("120px");
    expect(block.style.height).toBe("200px");
    expect(segments[1].style.top).toBe("60px");
    expect(segments[1].style.height).toBe("80px");
  });

  it("opens the details from a busy segment", () => {
    const onOpen = renderBlock();
    const segments = screen.getByTestId("desk-booking-101").querySelectorAll<HTMLElement>('[data-kind="busy"]');
    fireEvent.click(segments[1]);
    expect(onOpen).toHaveBeenCalledWith(101);
  });

  it("a busy tap opens the details and stays inside the block (the column never sees it)", () => {
    const onParent = vi.fn();
    const onOpen = renderBlock(barvanje, vi.fn(), { onParent });
    const busy = screen.getByTestId("desk-booking-101").querySelector<HTMLElement>('[data-kind="busy"]');
    fireEvent.click(busy as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(101);
    expect(onParent).not.toHaveBeenCalled();
  });

  it("passThrough (move mode, R12): busy segments take no pointer events and hand the tap to the column", () => {
    const onParent = vi.fn();
    const onOpen = renderBlock(barvanje, vi.fn(), { passThrough: true, onParent });
    const busy = Array.from(
      screen.getByTestId("desk-booking-101").querySelectorAll<HTMLElement>('[data-kind="busy"]')
    );
    expect(busy.map((b) => b.style.pointerEvents)).toEqual(["none", "none"]);
    fireEvent.click(busy[0]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onParent).toHaveBeenCalledTimes(1);
  });

  it("shows time, customer and services, 24-hour", () => {
    renderBlock();
    const block = screen.getByTestId("desk-booking-101");
    expect(block.textContent).toContain("09:00–10:40");
    expect(block.textContent).toContain("Marija Novak");
    expect(block.textContent).toContain("Barvanje");
  });

  it("draws an untrusted step copy as one solid busy segment", () => {
    renderBlock(booking({ bookingId: 7, memberId: 2, steps: null }));
    const segments = screen.getByTestId("desk-booking-7").querySelectorAll<HTMLElement>("[data-kind]");
    expect(Array.from(segments).map((s) => s.dataset.kind)).toEqual(["busy"]);
  });

  it("takes its lane: left offset and width", () => {
    render(
      <BookingBlock
        booking={barvanje}
        range={range}
        pxPerMinute={2}
        timeZone={TZ}
        lane={1}
        lanes={2}
        zIndex={10}
        onOpenDetails={vi.fn()}
      />
    );
    const block = screen.getByTestId("desk-booking-101");
    expect(block.style.left).toBe("50%");
    expect(block.style.width).toBe("50%");
  });
});
