// Flowko U28: „who are you“ (R9, design call 10). A label, never a right: the server takes rights from the
// signed-in user and refuses a WORKER naming someone else. OWNER/STAFF sessions (a shared desk device) choose
// from the ACTIVE members; the choice is kept per device and business in localStorage
// `flowko-desk-actor:<businessId>` and validated against the member list on every render. A WORKER is fixed to
// herself. Every desk write passes `actor.memberId` as `actorMemberId`.
// Flowko U28b (B1): the choice is optional. With no valid stored choice the actor is the signed-in member; no
// picker ever opens by itself (only the chip opens it). Choosing the signed-in member forgets the stored choice,
// and a `forbidden` answer calls `clear()` (the chosen member may have been locked meanwhile): back to herself.
// Flowko U29a (S7): all of the above only when the owner's „shared device“ switch is on (`sharedDevice`). Off: the
// actor is always the signed-in member, the picker never opens, and a stored choice is ignored and removed in an
// effect (never during render). `fixed` (WORKER) is unchanged, so the desk's canBook is unchanged.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { DeskMember } from "@calcom/features/flowkoBusiness/desk";
import { localStorage } from "@calcom/lib/webstorage";

// Flowko U29a (S7): + sharedDevice (business.me).
export type DeskSessionMember = {
  businessId: number;
  memberId: number;
  role: DeskMember["role"];
  sharedDevice: boolean;
};
export type DeskActor = { memberId: number; displayName: string };
export type DeskActorState = {
  /** Who acts at this device now: the stored choice, else the signed-in member; null while the member list loads. */
  actor: DeskActor | null;
  /** A WORKER session: the actor is the user herself and cannot change. */
  fixed: boolean;
  choices: DeskMember[];
  choose: (memberId: number) => void;
  clear: () => void;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
};

export const actorStorageKey = (businessId: number) => `flowko-desk-actor:${businessId}`;

const listeners = new Set<() => void>();
const notify = () => {
  listeners.forEach((l) => {
    l();
  });
};
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useDeskActor(
  me: DeskSessionMember | null,
  members: DeskMember[] | undefined
): DeskActorState {
  const key = me ? actorStorageKey(me.businessId) : null;
  const stored = useSyncExternalStore(
    subscribe,
    () => (key ? localStorage.getItem(key) : null),
    () => null
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const fixed = me?.role === "WORKER";
  // Flowko U29a (S7): a choice of another person exists only on a shared device.
  const shared = me?.sharedDevice === true;

  // Flowko U29a (S7): switch off → forget this business's stored choice (an effect, not during render).
  useEffect(() => {
    if (!key || shared || stored === null) return;
    localStorage.removeItem(key);
    notify();
  }, [key, shared, stored]);

  const actor = useMemo<DeskActor | null>(() => {
    if (!me || !members) return null;
    // Flowko U28b (B1): a stored choice only on a shared device and only while that member is ACTIVE, else herself.
    // Flowko U29a (S7): and only while the shared device switch is on.
    const chosen =
      fixed || !shared || stored === null ? undefined : members.find((m) => m.memberId === Number(stored));
    const member = chosen ?? members.find((m) => m.memberId === me.memberId);
    if (member) return { memberId: member.memberId, displayName: member.displayName };
    return { memberId: me.memberId, displayName: "" };
  }, [me, members, fixed, shared, stored]);

  const choose = useCallback(
    (memberId: number) => {
      if (!key || !me || fixed || !shared) return; // Flowko U29a (S7): + !shared
      // Flowko U28b (B1): the signed-in member is the default, so choosing her forgets the stored choice.
      if (memberId === me.memberId) localStorage.removeItem(key);
      else localStorage.setItem(key, String(memberId));
      notify();
      setPickerOpen(false);
    },
    [key, me, fixed, shared]
  );
  const clear = useCallback(() => {
    if (!key || fixed) return;
    localStorage.removeItem(key);
    notify();
  }, [key, fixed]);
  const openPicker = useCallback(() => {
    if (!fixed && shared) setPickerOpen(true); // Flowko U29a (S7): + shared
  }, [fixed, shared]);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  return {
    actor,
    fixed,
    choices: members ?? [],
    choose,
    clear,
    pickerOpen,
    openPicker,
    closePicker,
  };
}
