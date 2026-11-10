// Flowko U29b (S13, D7): Urnik's leave guard while the draft is dirty. (1) `beforeunload` (reload, tab close, a
// typed URL: the browser's own text). (2) A capture-phase document click listener: a plain left click on a
// same-origin `a[href]` that leaves this page (another path or another `?view=`) is stopped before Next's Link sees
// it (Link returns early on `defaultPrevented`) and asks; „Zavrzi in nadaljuj“ then pushes the link with the app
// router. Modifier, middle-button, `target` (other than _self) and `download` clicks pass; other origins are left to
// `beforeunload`. (3) `guard(action)`: in-page switches (week, view, mode) run at once when clean, else ask first.
// Browser Back is not intercepted (nuqs `replace`; accepted in the plan, S13). Clean: no listener at all.
// Flowko U29c (P5): while dirty, `guard` is also the app's registered leave guard (`lib/flowko/leaveGuard`), so the
// Cmd+K palette's navigations ask through the same dialog.
import { useRouter } from "next/navigation";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { registerLeaveGuard } from "@calcom/web/lib/flowko/leaveGuard"; // Flowko U29c

import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

/** The same-origin path a plain left click on a link would open when it leaves this page, else null. */
function leavingHref(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const frame = anchor.getAttribute("target");
  if ((frame && frame !== "_self") || anchor.hasAttribute("download")) return null;
  const here = new URL(window.location.href);
  const url = new URL(anchor.href, here);
  if (url.origin !== here.origin) return null;
  const sameView = url.searchParams.get("view") === here.searchParams.get("view");
  if (url.pathname === here.pathname && sameView) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function useUnsavedGuard(
  dirty: boolean,
  onDiscard: () => void
): { guard: (action: () => void) => void; dialog: ReactNode } {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show their dialog only when returnValue is set.
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      const href = leavingHref(event);
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => routerRef.current.push(href));
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const guard = useCallback(
    (action: () => void) => {
      if (!dirty) action();
      else setPending(() => action);
    },
    [dirty]
  );

  // Flowko U29c (P5): registered while dirty only; unregistered on clean and on unmount
  useEffect(() => {
    if (!dirty) return;
    return registerLeaveGuard(guard);
  }, [dirty, guard]);

  const dialog = createElement(UnsavedChangesDialog, {
    open: pending !== null,
    onStay: () => setPending(null),
    onDiscard: () => {
      const action = pending;
      setPending(null);
      onDiscard();
      action?.();
    },
  });

  return { guard, dialog };
}
