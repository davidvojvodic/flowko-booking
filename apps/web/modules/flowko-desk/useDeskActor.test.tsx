// Flowko U28: „who are you“ (R9). A shared device (OWNER/STAFF session) keeps the choice per business in
// localStorage, validated against the active members; a WORKER is always herself.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ANA, BOR, OLGA, members } from "./desk.fixture";
import { actorStorageKey, useDeskActor } from "./useDeskActor";

const owner = { businessId: 9, memberId: OLGA, role: "OWNER" as const };
const staff = { businessId: 9, memberId: 5, role: "STAFF" as const };
const worker = { businessId: 9, memberId: ANA, role: "WORKER" as const };

describe("useDeskActor (U28 R9)", () => {
  beforeEach(() => window.localStorage.clear());

  it("an OWNER session with no stored choice needs a choice", () => {
    const { result } = renderHook(() => useDeskActor(owner, members));
    expect(result.current.actor).toBeNull();
    expect(result.current.needsChoice).toBe(true);
    expect(result.current.fixed).toBe(false);
    expect(result.current.choices.map((m) => m.memberId)).toEqual(members.map((m) => m.memberId));
  });

  it("does not ask before the member list has arrived", () => {
    const { result } = renderHook(() => useDeskActor(owner, undefined));
    expect(result.current.needsChoice).toBe(false);
    expect(result.current.actor).toBeNull();
  });

  it("ignores a stored id of a member who is no longer active", () => {
    window.localStorage.setItem(actorStorageKey(9), "77");
    const { result } = renderHook(() => useDeskActor(staff, members));
    expect(result.current.actor).toBeNull();
    expect(result.current.needsChoice).toBe(true);
  });

  it("a WORKER is fixed to herself whatever the device stored", () => {
    window.localStorage.setItem(actorStorageKey(9), String(BOR));
    const { result } = renderHook(() => useDeskActor(worker, members));
    expect(result.current.actor).toEqual({ memberId: ANA, displayName: "Ana" });
    expect(result.current.fixed).toBe(true);
    expect(result.current.needsChoice).toBe(false);
    act(() => result.current.choose(BOR));
    expect(result.current.actor?.memberId).toBe(ANA);
  });

  it("a choice persists under flowko-desk-actor:<businessId> and survives a remount", () => {
    const first = renderHook(() => useDeskActor(owner, members));
    act(() => first.result.current.openPicker());
    expect(first.result.current.pickerOpen).toBe(true);
    act(() => first.result.current.choose(BOR));
    expect(window.localStorage.getItem("flowko-desk-actor:9")).toBe(String(BOR));
    expect(first.result.current.actor).toEqual({ memberId: BOR, displayName: "Bor" });
    expect(first.result.current.pickerOpen).toBe(false);
    first.unmount();
    const second = renderHook(() => useDeskActor(owner, members));
    expect(second.result.current.actor?.memberId).toBe(BOR);
    expect(second.result.current.needsChoice).toBe(false);
  });

  it("clear() forgets the stored choice (a forbidden answer) and the picker can reopen", () => {
    window.localStorage.setItem(actorStorageKey(9), String(BOR));
    const { result } = renderHook(() => useDeskActor(owner, members));
    expect(result.current.actor?.memberId).toBe(BOR);
    act(() => {
      result.current.clear();
      result.current.openPicker();
    });
    expect(window.localStorage.getItem(actorStorageKey(9))).toBeNull();
    expect(result.current.actor).toBeNull();
    expect(result.current.needsChoice).toBe(true);
    expect(result.current.pickerOpen).toBe(true);
  });

  it("a choice is per business", () => {
    window.localStorage.setItem(actorStorageKey(8), String(BOR));
    const { result } = renderHook(() => useDeskActor(owner, members));
    expect(result.current.actor).toBeNull();
  });
});
