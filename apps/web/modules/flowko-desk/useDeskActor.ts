// Flowko U28: „who are you“ (R9, design call 10). A label, never a right: the server takes rights from the
// signed-in user and refuses a WORKER naming someone else. OWNER/STAFF sessions (a shared desk device) choose
// from the ACTIVE members; the choice is kept per device and business in localStorage
// `flowko-desk-actor:<businessId>` and validated against the member list on every render. A WORKER is fixed to
// herself. Every desk write passes `actor.memberId` as `actorMemberId`; `needsChoice` opens the picker first, and
// a `forbidden` answer calls `clear()` + `openPicker()` (the chosen member may have been locked meanwhile).
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import type { DeskMember } from "@calcom/features/flowkoBusiness/desk";
import { localStorage } from "@calcom/lib/webstorage";

export type DeskSessionMember = { businessId: number; memberId: number; role: DeskMember["role"] };
export type DeskActor = { memberId: number; displayName: string };
export type DeskActorState = {
  /** Who acts at this device now; null until chosen (or while the member list loads). */
  actor: DeskActor | null;
  /** A WORKER session: the actor is the user herself and cannot change. */
  fixed: boolean;
  /** The member list is known and nobody valid is chosen: open the picker before the first write. */
  needsChoice: boolean;
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

  const actor = useMemo<DeskActor | null>(() => {
    if (!me || !members) return null;
    const id = fixed ? me.memberId : Number(stored);
    const member = members.find((m) => m.memberId === id);
    if (member) return { memberId: member.memberId, displayName: member.displayName };
    return fixed ? { memberId: me.memberId, displayName: "" } : null;
  }, [me, members, fixed, stored]);

  const choose = useCallback(
    (memberId: number) => {
      if (!key || fixed) return;
      localStorage.setItem(key, String(memberId));
      notify();
      setPickerOpen(false);
    },
    [key, fixed]
  );
  const clear = useCallback(() => {
    if (!key || fixed) return;
    localStorage.removeItem(key);
    notify();
  }, [key, fixed]);
  const openPicker = useCallback(() => {
    if (!fixed) setPickerOpen(true);
  }, [fixed]);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  return {
    actor,
    fixed,
    needsChoice: !fixed && members !== undefined && me !== null && actor === null,
    choices: members ?? [],
    choose,
    clear,
    pickerOpen,
    openPicker,
    closePicker,
  };
}
