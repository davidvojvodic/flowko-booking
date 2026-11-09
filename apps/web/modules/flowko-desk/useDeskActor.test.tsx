// Flowko U28: „who are you“ (R9). A shared device (OWNER/STAFF session) keeps the choice per business in
// localStorage, validated against the active members; a WORKER is always herself.
// Flowko U28b (B1): the choice is optional: with no valid stored choice the actor is the signed-in member, and no
// picker is ever forced open.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ANA, BOR, CENE, OLGA, members } from "./desk.fixture";
import { actorStorageKey, useDeskActor } from "./useDeskActor";

// Flowko U29a (S7): the U28/U28b cases below run with the shared device switch on (their meaning unchanged).
const owner = { businessId: 9, memberId: OLGA, role: "OWNER" as const, sharedDevice: true };
const staff = { businessId: 9, memberId: 5, role: "STAFF" as const, sharedDevice: true };
const worker = { businessId: 9, memberId: ANA, role: "WORKER" as const, sharedDevice: true };

describe("useDeskActor (U28 R9, U28b B1)", () => {
  beforeEach(() => window.localStorage.clear());

  it("an OWNER session with no stored choice acts as herself and no picker opens", () => {
    const { result } = renderHook(() => useDeskActor(owner, members));
    expect(result.current.actor).toEqual({ memberId: OLGA, displayName: "Olga" });
    expect(result.current.pickerOpen).toBe(false);
    expect(result.current.fixed).toBe(false);
    expect(result.current.choices.map((m) => m.memberId)).toEqual(members.map((m) => m.memberId));
  });

  it("has no actor and opens nothing before the member list has arrived", () => {
    const { result } = renderHook(() => useDeskActor(owner, undefined));
    expect(result.current.actor).toBeNull();
    expect(result.current.pickerOpen).toBe(false);
  });

  it("a stored id of a member who is no longer active falls back to the signed-in member", () => {
    window.localStorage.setItem(actorStorageKey(9), "77");
    const { result } = renderHook(() => useDeskActor(staff, members));
    expect(result.current.actor).toEqual({ memberId: 5, displayName: "Rok" });
    expect(result.current.pickerOpen).toBe(false);
  });

  it("a WORKER is fixed to herself whatever the device stored", () => {
    window.localStorage.setItem(actorStorageKey(9), String(BOR));
    const { result } = renderHook(() => useDeskActor(worker, members));
    expect(result.current.actor).toEqual({ memberId: ANA, displayName: "Ana" });
    expect(result.current.fixed).toBe(true);
    act(() => result.current.choose(BOR));
    expect(result.current.actor?.memberId).toBe(ANA);
    act(() => result.current.openPicker());
    expect(result.current.pickerOpen).toBe(false);
  });

  it("a choice persists under flowko-desk-actor:<businessId> and survives a remount", () => {
    const first = renderHook(() => useDeskActor(owner, members));
    act(() => first.result.current.openPicker());
    expect(first.result.current.pickerOpen).toBe(true);
    act(() => first.result.current.choose(CENE));
    expect(window.localStorage.getItem("flowko-desk-actor:9")).toBe(String(CENE));
    expect(first.result.current.actor).toEqual({ memberId: CENE, displayName: "Cene" });
    expect(first.result.current.pickerOpen).toBe(false);
    first.unmount();
    const second = renderHook(() => useDeskActor(owner, members));
    expect(second.result.current.actor?.memberId).toBe(CENE);
  });

  it("choosing the signed-in member again forgets the stored choice (back to herself)", () => {
    window.localStorage.setItem(actorStorageKey(9), String(BOR));
    const { result } = renderHook(() => useDeskActor(owner, members));
    expect(result.current.actor?.memberId).toBe(BOR);
    act(() => result.current.choose(OLGA));
    expect(window.localStorage.getItem(actorStorageKey(9))).toBeNull();
    expect(result.current.actor).toEqual({ memberId: OLGA, displayName: "Olga" });
    expect(result.current.pickerOpen).toBe(false);
  });

  it("clear() forgets the stored choice (a forbidden answer): back to herself, no picker", () => {
    window.localStorage.setItem(actorStorageKey(9), String(BOR));
    const { result } = renderHook(() => useDeskActor(owner, members));
    expect(result.current.actor?.memberId).toBe(BOR);
    act(() => result.current.clear());
    expect(window.localStorage.getItem(actorStorageKey(9))).toBeNull();
    expect(result.current.actor?.memberId).toBe(OLGA);
    expect(result.current.pickerOpen).toBe(false);
  });

  it("a choice is per business", () => {
    window.localStorage.setItem(actorStorageKey(8), String(BOR));
    const { result } = renderHook(() => useDeskActor(owner, members));
    expect(result.current.actor?.memberId).toBe(OLGA);
  });
});

// Flowko U29a (S7): switch off = the signed-in member acts, a stored choice is ignored and removed (in an effect),
// the picker never opens; a WORKER stays fixed (canBook keeps using `fixed`).
describe("useDeskActor with the shared device switch off (U29a S7)", () => {
  beforeEach(() => window.localStorage.clear());
  const off = <T extends object>(session: T) => ({ ...session, sharedDevice: false });

  it("ignores a stored choice and acts as the signed-in member, then removes it", async () => {
    window.localStorage.setItem(actorStorageKey(9), String(BOR));
    window.localStorage.setItem(actorStorageKey(8), String(BOR));
    const { result } = renderHook(() => useDeskActor(off(owner), members));
    expect(result.current.actor).toEqual({ memberId: OLGA, displayName: "Olga" });
    expect(result.current.fixed).toBe(false);
    await waitFor(() => expect(window.localStorage.getItem(actorStorageKey(9))).toBeNull());
    expect(window.localStorage.getItem(actorStorageKey(8))).toBe(String(BOR));
  });

  it("choose and openPicker do nothing", () => {
    const { result } = renderHook(() => useDeskActor(off(staff), members));
    act(() => result.current.openPicker());
    expect(result.current.pickerOpen).toBe(false);
    act(() => result.current.choose(CENE));
    expect(window.localStorage.getItem(actorStorageKey(9))).toBeNull();
    expect(result.current.actor).toEqual({ memberId: 5, displayName: "Rok" });
  });

  it("a WORKER is still fixed to herself", () => {
    const { result } = renderHook(() => useDeskActor(off(worker), members));
    expect(result.current.actor).toEqual({ memberId: ANA, displayName: "Ana" });
    expect(result.current.fixed).toBe(true);
  });

  it("switching the device off removes the choice; on again does not bring it back", async () => {
    window.localStorage.setItem(actorStorageKey(9), String(CENE));
    const { result, rerender } = renderHook(({ session }) => useDeskActor(session, members), {
      initialProps: { session: owner },
    });
    expect(result.current.actor?.memberId).toBe(CENE);
    rerender({ session: off(owner) });
    expect(result.current.actor?.memberId).toBe(OLGA);
    await waitFor(() => expect(window.localStorage.getItem(actorStorageKey(9))).toBeNull());
    rerender({ session: owner });
    expect(result.current.actor?.memberId).toBe(OLGA);
  });
});
