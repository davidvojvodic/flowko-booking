// Flowko U29b (Task 7, S8, Ruling R3): the holiday label in a day header and the owner's menu „Odpri ta dan“ /
// „Zapri ta dan“ (saved at once, refresh with the settings), the hint + link while the closing switch is off, the
// disabled action while the draft is dirty, and the label-only view for everyone else.
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

function renderMenu(over: Partial<Parameters<typeof RosterHolidayMenu>[0]> = {}) {
  return render(
    <RosterHolidayMenu
      date={DATE}
      holiday={{ name: "Božič", open: false }}
      holidaysClosed
      canManage
      dirty={false}
      {...over}
    />
  );
}
const label = () => screen.getByTestId(`roster-holiday-${DATE}`);

describe("RosterHolidayMenu (U29b Task 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
    invalidate.mockResolvedValue(undefined);
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
    expect(screen.getByText(/zapiranje ob praznikih v nastavitvah podjetja izklopljeno/)).toBeTruthy();
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
});
