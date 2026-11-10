// Flowko U29b (Task 7, S8, Ruling R3): the holiday label in a day header and the owner's menu „Odpri ta dan“ /
// „Zapri ta dan“ (saved at once, refresh with the settings), the hint + link while the closing switch is off, the
// disabled action while the draft is dirty, and the label-only view for everyone else. Flowko U29c (P1, P8): a saved
// change shows „Shranjeno“; a failed roster.week refresh after it calls onRefreshFailed (RosterView's notice).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RosterHolidayMenu } from "./RosterHolidayMenu";
import { localeT } from "./desk.fixture";
import { deskTrpc, resetDeskTrpc, trpcError } from "./desk.testDoubles";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));
vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
const toast = vi.fn();
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => toast(...args) }));
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("./useRosterData", () => ({ useInvalidateRoster: () => invalidate }));

const DATE = "2026-11-19";
const onRefreshFailed = vi.fn();

function renderMenu(over: Partial<Parameters<typeof RosterHolidayMenu>[0]> = {}) {
  return render(
    <RosterHolidayMenu
      date={DATE}
      holiday={{ name: "Božič", open: false }}
      holidaysClosed
      canManage
      dirty={false}
      onRefreshFailed={onRefreshFailed}
      {...over}
    />
  );
}
const label = () => screen.getByTestId(`roster-holiday-${DATE}`);

describe("RosterHolidayMenu (U29b Task 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
    // Flowko U29c (P1): the refresh answers whether roster.week was read again.
    invalidate.mockResolvedValue(true);
    deskTrpc.setHolidayOpen.mockResolvedValue({ status: "saved" });
  });
  afterEach(cleanup);

  it("shows the desk's closed/open text with the holiday name", () => {
    const { unmount } = renderMenu();
    expect(label().textContent).toBe("Božič – zaprto");
    unmount();
    renderMenu({ holiday: { name: "Božič", open: true } });
    expect(label().textContent).toBe("Božič – odprto");
  });

  it("never truncates the label: the state word stays in the DOM, the full text is the title", () => {
    const { unmount } = renderMenu({ holiday: { name: "Dan reformacije in zelo dolgo ime", open: false } });
    expect(label().className).not.toContain("truncate");
    expect(label().className).toContain("break-words");
    expect(label().textContent).toBe("Dan reformacije in zelo dolgo ime – zaprto");
    expect(label().getAttribute("title")).toBe("Dan reformacije in zelo dolgo ime – zaprto");
    unmount();
    renderMenu({ canManage: false, holiday: { name: "Božič", open: true } });
    expect(label().className).not.toContain("truncate");
    expect(label().getAttribute("title")).toBe("Božič – odprto");
  });

  it("is a plain label (no button, no menu) for someone who may not manage the business", () => {
    renderMenu({ canManage: false });
    expect(label().tagName).not.toBe("BUTTON");
    fireEvent.click(label());
    expect(screen.queryByText("Odpri ta dan")).toBeNull();
  });

  it("offers „Odpri ta dan“ on a closed holiday and saves it at once, then refreshes with the settings", async () => {
    renderMenu();
    fireEvent.click(label());
    fireEvent.click(screen.getByRole("button", { name: "Odpri ta dan" }));
    await waitFor(() => expect(deskTrpc.setHolidayOpen).toHaveBeenCalledWith({ date: DATE, open: true }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ settings: true }));
    await waitFor(() => expect(screen.queryByText("Odpri ta dan")).toBeNull());
  });

  it("offers „Zapri ta dan“ on an open holiday", async () => {
    renderMenu({ holiday: { name: "Božič", open: true } });
    fireEvent.click(label());
    fireEvent.click(screen.getByRole("button", { name: "Zapri ta dan" }));
    await waitFor(() => expect(deskTrpc.setHolidayOpen).toHaveBeenCalledWith({ date: DATE, open: false }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ settings: true }));
  });

  it("with the closing switch off shows a hint and a link to the business settings, and never saves", () => {
    renderMenu({ holidaysClosed: false, holiday: { name: "Božič", open: true } });
    fireEvent.click(label());
    expect(screen.getByText(/v nastavitvah podjetja možnost „Ob praznikih zaprto“ izklopljena/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Odpri nastavitve podjetja" }).getAttribute("href")).toBe(
      "/settings/podjetje/profil"
    );
    expect(screen.queryByRole("button", { name: "Zapri ta dan" })).toBeNull();
    expect(deskTrpc.setHolidayOpen).not.toHaveBeenCalled();
  });

  it("while the draft is dirty the action is disabled with a hint (Ruling R3)", () => {
    renderMenu({ dirty: true });
    fireEvent.click(label());
    const action = screen.getByRole("button", { name: "Odpri ta dan" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(screen.getByText("Najprej shranite ali zavrzite spremembe urnika.")).toBeTruthy();
    fireEvent.click(action);
    expect(deskTrpc.setHolidayOpen).not.toHaveBeenCalled();
  });

  it("a failed save toasts, refreshes the roster and keeps the menu usable", async () => {
    deskTrpc.setHolidayOpen.mockRejectedValue(trpcError("not_a_holiday"));
    renderMenu();
    fireEvent.click(label());
    fireEvent.click(screen.getByRole("button", { name: "Odpri ta dan" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Dneva ni bilo mogoče spremeniti. Urnik je osvežen; poskusite znova.",
        "error"
      )
    );
    expect(invalidate).toHaveBeenCalledWith({ settings: true });
    expect((screen.getByRole("button", { name: "Odpri ta dan" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ["closed", false, "Odpri ta dan"],
    ["open", true, "Zapri ta dan"],
  ])("a saved change of a %s holiday shows „Shranjeno“ (U29c P8)", async (_, open, action) => {
    renderMenu({ holiday: { name: "Božič", open } });
    fireEvent.click(label());
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Shranjeno", "success"));
    expect(onRefreshFailed).not.toHaveBeenCalled();
  });

  it("a failed refresh after a saved change: „Shranjeno“, onRefreshFailed, the menu closes (U29c P1)", async () => {
    invalidate.mockResolvedValue(false);
    renderMenu();
    fireEvent.click(label());
    fireEvent.click(screen.getByRole("button", { name: "Odpri ta dan" }));
    await waitFor(() => expect(onRefreshFailed).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith("Shranjeno", "success");
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), "error");
    await waitFor(() => expect(screen.queryByText("Odpri ta dan")).toBeNull());
  });

  it("a failed save shows no „Shranjeno“ and no refresh-failed call", async () => {
    deskTrpc.setHolidayOpen.mockRejectedValue(trpcError("not_a_holiday"));
    invalidate.mockResolvedValue(false);
    renderMenu();
    fireEvent.click(label());
    fireEvent.click(screen.getByRole("button", { name: "Odpri ta dan" }));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast).not.toHaveBeenCalledWith("Shranjeno", "success");
    expect(onRefreshFailed).not.toHaveBeenCalled();
  });
});
