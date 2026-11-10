// Flowko U29c (P5): the leave-guard registry. No guard: a plain, synchronous push. A guard (Urnik while dirty) gets
// the push as `go`, one tick later so kbar's own close and focus restore finish before a dialog opens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardedPush, registerLeaveGuard } from "./leaveGuard";

describe("leaveGuard (U29c P5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no guard: push(href) once, synchronously", () => {
    const push = vi.fn();
    guardedPush(push, "/bookings/upcoming");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/bookings/upcoming");
  });

  it("a guard is called after the timers and push waits for go", () => {
    const push = vi.fn();
    const guard = vi.fn();
    const off = registerLeaveGuard(guard);
    guardedPush(push, "/event-types");
    expect(guard).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    guard.mock.calls[0][0]();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/event-types");
    off();
  });

  it("unregister: back to a plain push", () => {
    const push = vi.fn();
    const guard = vi.fn();
    const off = registerLeaveGuard(guard);
    off();
    guardedPush(push, "/a");
    expect(push).toHaveBeenCalledWith("/a");
    vi.runAllTimers();
    expect(guard).not.toHaveBeenCalled();
  });

  it("a second registration replaces the first; the first's unregister leaves the second", () => {
    const push = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registerLeaveGuard(first);
    const offSecond = registerLeaveGuard(second);
    offFirst();
    guardedPush(push, "/b");
    vi.runAllTimers();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    offSecond();
    guardedPush(push, "/c");
    expect(push).toHaveBeenCalledWith("/c");
  });

  it("a guard unregistered before the timer fires still decides this push (it was the guard when asked)", () => {
    const push = vi.fn();
    const guard = vi.fn();
    const off = registerLeaveGuard(guard);
    guardedPush(push, "/d");
    off();
    vi.runAllTimers();
    expect(guard).toHaveBeenCalledTimes(1);
  });
});
