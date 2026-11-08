// Flowko U28: move mode (R12): a tap in the booking's own column moves it (with the override dialog on
// needs_confirm), other columns are ignored, Esc or stop leaves the mode, success leaves it too.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FitProblem } from "@calcom/lib/flowkoSalon";

import { ANA, BOR, at, barvanje, iso } from "./desk.fixture";
import type { DeskWrites } from "./useDeskWrites";
import { useMoveMode } from "./useMoveMode";

function writesDouble(move: DeskWrites["move"]): DeskWrites {
  return {
    create: vi.fn(),
    move: vi.fn(move),
    cancel: vi.fn(),
    noShow: vi.fn(),
  } as unknown as DeskWrites;
}

describe("useMoveMode (U28 R12)", () => {
  let writes: DeskWrites;
  const onMoved = vi.fn();
  beforeEach(() => {
    onMoved.mockReset();
    writes = writesDouble(async () => ({
      kind: "done",
      result: { status: "moved", bookingId: 101, uid: "u" },
    }));
  });

  function setup() {
    const { result } = renderHook(() => useMoveMode(writes, { onMoved }));
    act(() => result.current.start(barvanje));
    return result;
  }

  it("a tap in the same column moves the booking and leaves move mode", async () => {
    const result = setup();
    expect(result.current.moving?.bookingId).toBe(101);
    await act(async () => result.current.tap({ memberId: ANA, start: at("11:00") }));
    expect(writes.move).toHaveBeenCalledWith({ bookingId: 101, start: iso("11:00") }, undefined);
    expect(result.current.moving).toBeNull();
    expect(onMoved).toHaveBeenCalled();
  });

  it("a tap in another column is ignored", async () => {
    const result = setup();
    await act(async () => result.current.tap({ memberId: BOR, start: at("13:00") }));
    expect(writes.move).not.toHaveBeenCalled();
    expect(result.current.moving?.bookingId).toBe(101);
  });

  it("Esc and stop leave move mode", () => {
    const result = setup();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.moving).toBeNull();
    act(() => result.current.start(barvanje));
    act(() => result.current.stop());
    expect(result.current.moving).toBeNull();
  });

  it("needs_confirm keeps the mode and asks; the override resends with confirmOverride", async () => {
    const problems: FitProblem[] = [
      { kind: "overlaps_booking", step: 0, with: { start: at("11:00"), end: at("11:30") } },
    ];
    writes = writesDouble(async (input) =>
      (input as { confirmOverride?: boolean }).confirmOverride
        ? { kind: "done", result: { status: "moved", bookingId: 101, uid: "u" } }
        : { kind: "confirm", problems, googleUnavailable: false }
    );
    const result = setup();
    await act(async () => result.current.tap({ memberId: ANA, start: at("11:00") }));
    expect(result.current.confirm).toMatchObject({ start: at("11:00"), problems });
    expect(result.current.moving?.bookingId).toBe(101);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.moving?.bookingId).toBe(101);
    await act(async () => result.current.confirmOverride());
    expect(writes.move).toHaveBeenLastCalledWith(
      { bookingId: 101, start: iso("11:00"), confirmOverride: true },
      undefined
    );
    expect(result.current.confirm).toBeNull();
    expect(result.current.moving).toBeNull();
  });

  it("an error that ends the booking's move leaves move mode; others keep it", async () => {
    writes = writesDouble(async () => ({ kind: "error", code: "duplicate_time", message: "x" }));
    let result = setup();
    await act(async () => result.current.tap({ memberId: ANA, start: at("11:00") }));
    expect(result.current.moving?.bookingId).toBe(101);
    writes = writesDouble(async () => ({ kind: "error", code: "booking_not_active", message: "x" }));
    result = setup();
    await act(async () => result.current.tap({ memberId: ANA, start: at("11:00") }));
    expect(result.current.moving).toBeNull();
  });

  it("moveTo (the sheet's date and time) moves a booking outside move mode and passes field codes", async () => {
    const { result } = renderHook(() => useMoveMode(writes, { onMoved }));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.moveTo(barvanje, at("12:00", "2026-11-19"), { fieldCodes: ["in_past"] });
    });
    expect(writes.move).toHaveBeenCalledWith(
      { bookingId: 101, start: iso("12:00", "2026-11-19") },
      { fieldCodes: ["in_past"] }
    );
    expect(outcome).toMatchObject({ kind: "done" });
    expect(onMoved).toHaveBeenCalled();
  });
});
