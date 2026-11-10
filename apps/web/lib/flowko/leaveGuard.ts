// Flowko U29c (P5): one shared leave-guard slot, so the Cmd+K palette (kbar) can ask before it leaves an Urnik with
// unsaved changes. `useUnsavedGuard` registers its `guard` while the draft is dirty; Kbar's local `useGuardedPush()`
// sends every `router.push` through `guardedPush`. Client only. Browser Back stays unguarded (known limit).
//
// kbar runs `perform(); query.toggle()` on Enter and click, and `toggle` flips the palette; so Flowko code never
// touches the palette. With a guard, the push is deferred by one tick: kbar's own close and focus restore finish
// first, then the guard (a dialog) opens and keeps the focus.
type LeaveGuard = (go: () => void) => void;

let current: LeaveGuard | null = null;

/** Registers the one active guard (a later registration replaces it); the returned function removes only this one. */
export function registerLeaveGuard(fn: LeaveGuard): () => void {
  current = fn;
  return () => {
    if (current === fn) current = null;
  };
}

/** No guard: `push(href)` at once. A guard: it gets the push as `go`, one tick later. */
export function guardedPush(push: (href: string) => void, href: string): void {
  const guard = current;
  if (guard === null) {
    push(href);
    return;
  }
  setTimeout(() => guard(() => push(href)), 0);
}
