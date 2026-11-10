// Flowko U29b (S13): the leave guard of Urnik. While dirty: `beforeunload`, a plain left click on a link that leaves
// /koledar?view=roster asks first („Neshranjene spremembe“, focus on „Ostani“), and in-page actions run through
// `guard`. Modifier and new-tab clicks pass; a clean draft never asks.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardedPush } from "@calcom/web/lib/flowko/leaveGuard"; // U29c (P5)

import { localeT } from "./desk.fixture";
import { useUnsavedGuard } from "./useUnsavedGuard";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigation.push }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));

const onDiscard = vi.fn();
const action = vi.fn();

function Harness({ dirty }: { dirty: boolean }) {
  const { guard, dialog } = useUnsavedGuard(dirty, onDiscard);
  return (
    <div>
      <a href="/bookings/upcoming">Termini</a>
      <a href="/bookings/upcoming" target="_blank" rel="noreferrer">
        Nov zavihek
      </a>
      <a href="/koledar?view=roster&date=2026-11-23">Naslednji teden</a>
      <button type="button" onClick={() => guard(action)}>
        Teden
      </button>
      <button type="button">Paleta</button>
      {dialog}
    </div>
  );
}

/** Whether the click reached the document's bubble phase un-prevented (then stopped there: jsdom has no navigation). */
const passed: boolean[] = [];
function recordBubble(e: MouseEvent) {
  passed.push(!e.defaultPrevented);
  e.preventDefault();
}

const dialogNamed = () => screen.queryByRole("dialog", { name: "Neshranjene spremembe" });

describe("useUnsavedGuard (U29b S13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    passed.length = 0;
    document.addEventListener("click", recordBubble);
  });
  afterEach(() => {
    document.removeEventListener("click", recordBubble);
    cleanup();
  });

  it("dirty: beforeunload is prevented; clean: it is not", () => {
    const { rerender } = render(<Harness dirty />);
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    rerender(<Harness dirty={false} />);
    const cleanEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it("dirty: a link that leaves is stopped and asks, with „Ostani“ focused", async () => {
    render(<Harness dirty />);
    const notCancelled = fireEvent.click(screen.getByText("Termini"));
    expect(notCancelled).toBe(false);
    expect(passed).toEqual([]); // stopped in the capture phase: the page's own handlers never see it
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Ostani" })).toHaveFocus());
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("„Zavrzi in nadaljuj“ discards, then follows the link", async () => {
    render(<Harness dirty />);
    fireEvent.click(screen.getByText("Termini"));
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zavrzi in nadaljuj" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith("/bookings/upcoming");
    expect(onDiscard.mock.invocationCallOrder[0]).toBeLessThan(navigation.push.mock.invocationCallOrder[0]);
    await waitFor(() => expect(dialogNamed()).toBeNull());
  });

  it("„Ostani“ closes the dialog: no discard, no navigation", async () => {
    render(<Harness dirty />);
    fireEvent.click(screen.getByText("Termini"));
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ostani" }));
    await waitFor(() => expect(dialogNamed()).toBeNull());
    expect(onDiscard).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("modifier clicks, a middle click and target=_blank pass untouched", () => {
    render(<Harness dirty />);
    fireEvent.click(screen.getByText("Termini"), { metaKey: true });
    fireEvent.click(screen.getByText("Termini"), { ctrlKey: true });
    fireEvent.click(screen.getByText("Termini"), { shiftKey: true });
    fireEvent.click(screen.getByText("Termini"), { button: 1 });
    fireEvent.click(screen.getByText("Nov zavihek"));
    expect(passed).toEqual([true, true, true, true, true]);
    expect(dialogNamed()).toBeNull();
  });

  it("a link that stays on /koledar?view=roster is not the guard's (the page decides)", () => {
    window.history.replaceState(null, "", "/koledar?view=roster");
    render(<Harness dirty />);
    fireEvent.click(screen.getByText("Naslednji teden"));
    expect(passed).toEqual([true]);
    expect(dialogNamed()).toBeNull();
    window.history.replaceState(null, "", "/");
  });

  it("dirty: guard(action) asks first; „Zavrzi in nadaljuj“ discards, then runs the action", async () => {
    render(<Harness dirty />);
    fireEvent.click(screen.getByRole("button", { name: "Teden" }));
    expect(action).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zavrzi in nadaljuj" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(onDiscard.mock.invocationCallOrder[0]).toBeLessThan(action.mock.invocationCallOrder[0]);
  });

  it("clean: guard(fn) runs fn at once, links pass, no dialog", () => {
    render(<Harness dirty={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Teden" }));
    expect(action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Termini"));
    expect(passed).toEqual([true, true]); // the button's click bubbles too
    expect(dialogNamed()).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});

// Flowko U29c (P5): the Cmd+K palette leaves through `guardedPush`; while dirty the hook's guard is registered, so the
// same dialog asks. kbar closes its palette and restores the focus to the opener AFTER perform(), which is why the
// guard opens one tick later and still ends with „Ostani“ focused.
describe("useUnsavedGuard leave guard (U29c P5)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("dirty: guardedPush from outside asks; „Ostani“ ends focused after kbar's focus restore", async () => {
    render(<Harness dirty />);
    guardedPush(navigation.push, "/event-types");
    expect(navigation.push).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Paleta" }).focus(); // kbar's own restore, right after perform()
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Ostani" })).toHaveFocus());
    expect(navigation.push).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("„Zavrzi in nadaljuj“ discards, then pushes", async () => {
    render(<Harness dirty />);
    guardedPush(navigation.push, "/event-types");
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zavrzi in nadaljuj" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith("/event-types");
    expect(onDiscard.mock.invocationCallOrder[0]).toBeLessThan(navigation.push.mock.invocationCallOrder[0]);
  });

  it("„Ostani“ keeps the draft and does not push", async () => {
    render(<Harness dirty />);
    guardedPush(navigation.push, "/event-types");
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ostani" }));
    await waitFor(() => expect(dialogNamed()).toBeNull());
    expect(navigation.push).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("clean: a plain, synchronous push and no dialog", () => {
    render(<Harness dirty={false} />);
    guardedPush(navigation.push, "/event-types");
    expect(navigation.push).toHaveBeenCalledWith("/event-types");
    expect(dialogNamed()).toBeNull();
  });

  it("the guard is unregistered when the draft turns clean and when the page unmounts", () => {
    const { rerender, unmount } = render(<Harness dirty />);
    rerender(<Harness dirty={false} />);
    guardedPush(navigation.push, "/a");
    expect(navigation.push).toHaveBeenCalledWith("/a");
    rerender(<Harness dirty />);
    unmount();
    guardedPush(navigation.push, "/b");
    expect(navigation.push).toHaveBeenLastCalledWith("/b");
  });
});
