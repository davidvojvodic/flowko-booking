// Flowko U28: the desk entry: data, date from the URL (business today by default), „who are you“ chip, and the
// phone layout (one column at a time with a worker select, R15).
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeskView as DeskViewData } from "@calcom/features/flowkoBusiness/desk";

import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";

import type { RosterView as RosterViewType } from "./RosterView";
import DeskView from "./desk-view";
import {
  ANA,
  BOR,
  CENE,
  NOW,
  OLGA,
  at,
  businessMe,
  deskView,
  iso,
  localeT,
  rosterWeek,
  weekViewOf,
} from "./desk.fixture";
import { deskTrpc, resetDeskTrpc } from "./desk.testDoubles";

// Flowko U29b: Urnik's leave guard pushes with the app router; no desk file had next/navigation before.
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigation.push }) }));

// Flowko U29b: the real RosterView, plus (when a test switches it on) a probe that drives the props DeskView hands
// it: the draft, the guarded day/mode callbacks, and what DeskView passes as date/today/mode.
const rosterProbe = vi.hoisted(() => ({ on: false }));
vi.mock("./RosterView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./RosterView")>();
  function ProbedRosterView(props: Parameters<typeof RosterViewType>[0]) {
    return (
      <>
        <actual.RosterView {...props} />
        {rosterProbe.on && (
          <div data-testid="roster-probe">
            <span data-testid="probe-state">
              {JSON.stringify({
                mode: props.mode,
                date: props.date,
                today: props.today,
                isPhone: props.isPhone,
                weekStart: props.view?.weekStart ?? null,
                changed: props.draft.changedCount,
              })}
            </span>
            <button
              type="button"
              onClick={() =>
                props.view && props.draft.set(props.view, 2, `${props.view.weekStart.slice(0, 8)}17`, [])
              }>
              probe-edit
            </button>
            <button type="button" onClick={() => props.onOpenDay("2026-11-18")}>
              probe-open-day
            </button>
            <button type="button" onClick={() => props.onModeChange("usual")}>
              probe-usual
            </button>
          </div>
        )}
      </>
    );
  }
  return { ...actual, RosterView: ProbedRosterView };
});

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));

const isPhone = vi.fn(() => false);
vi.mock("@calcom/lib/hooks/useMediaQuery", () => ({ default: () => isPhone() }));

const me = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoBusiness", () => ({ useFlowkoBusiness: () => me() }));

vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
const toast = vi.fn();
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => toast(...args) }));

const dayQuery = deskTrpc.dayQuery;
const refetch = vi.fn();

function answer(view: DeskViewData | undefined, extra: Record<string, unknown> = {}) {
  dayQuery.mockReturnValue({
    data: view,
    dataUpdatedAt: NOW.getTime(),
    refetch,
    isPending: !view,
    error: null,
    ...extra,
  });
}

function deskTree(searchParams = "", onUrlUpdate?: (e: UrlUpdateEvent) => void) {
  return (
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate} hasMemory>
      <TooltipProvider>
        <DeskView />
      </TooltipProvider>
    </NuqsTestingAdapter>
  );
}

function renderDesk(searchParams = "", onUrlUpdate?: (e: UrlUpdateEvent) => void) {
  return render(deskTree(searchParams, onUrlUpdate));
}

const headers = () => screen.getAllByTestId(/^desk-column-header-/).map((h) => h.textContent);
const requestedDates = () => dayQuery.mock.calls.map((c) => (c[0] as { date: string }).date);
// Flowko U28c (M3): calendar move mode starts from the move panel's link („Prestavi“ opens the panel first).
function startCalendarMove() {
  fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
  fireEvent.click(screen.getByRole("button", { name: "ali izberite čas na koledarju" }));
}

describe("DeskView (U28)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    isPhone.mockReturnValue(false);
    me.mockReturnValue(businessMe(OLGA, "OWNER", true));
    answer(deskView());
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("on a tablet shows every column, today by default, and names the signed-in member on the chip (U28b B1)", () => {
    renderDesk();
    expect(requestedDates()).toContain("2026-11-16");
    expect(headers()).toEqual(["Olga", "Ana", "Bor", "Cene", "Dan (zaklenjeno)"]);
    expect(screen.getByRole("button", { name: "Ste: Olga" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kdo ste?" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryAllByTestId(/^desk-actor-option-/)).toHaveLength(0);
    expect(screen.queryByLabelText("Delavec")).toBeNull();
  });

  it("asks for the date in the URL", () => {
    answer(deskView({}, "2026-11-18"));
    renderDesk("?date=2026-11-18");
    expect(Array.from(new Set(requestedDates()))).toEqual(["2026-11-18"]);
  });

  it("takes today from the business clock when the browser's date differs", () => {
    // 23:30Z on the 16th is 00:30 on the 17th in Ljubljana; the browser (TZ=UTC) first guesses the 16th.
    vi.setSystemTime(new Date("2026-11-16T23:30:00Z"));
    dayQuery.mockImplementation((input: { date: string }) => ({
      data: { ...deskView({}, input.date), now: "2026-11-16T23:30:00.000Z" },
      dataUpdatedAt: Date.now(),
      refetch,
      isPending: false,
      error: null,
    }));
    renderDesk();
    expect(requestedDates()[0]).toBe("2026-11-16");
    expect(requestedDates()[requestedDates().length - 1]).toBe("2026-11-17");
  });

  it("names the stored actor on the chip", () => {
    window.localStorage.setItem("flowko-desk-actor:9", String(BOR));
    renderDesk();
    expect(screen.getByRole("button", { name: "Ste: Bor" })).toBeInTheDocument();
  });

  it("on a phone shows one column with a worker select, defaulting to the user's own column", () => {
    isPhone.mockReturnValue(true);
    me.mockReturnValue(businessMe(ANA, "WORKER", true));
    const view = deskView();
    view.me = { memberId: ANA, role: "WORKER" };
    view.days[0].columns = view.days[0].columns.map((c) => ({ ...c, isMe: c.memberId === ANA }));
    answer(view);
    renderDesk();
    const select = screen.getByLabelText("Delavec") as HTMLSelectElement;
    expect(select.value).toBe(String(ANA));
    expect(headers()).toEqual(["Ana"]);
    expect(screen.getByTestId("desk-actor-chip").textContent).toBe("Ste: Ana");
    fireEvent.change(select, { target: { value: String(BOR) } });
    expect(headers()).toEqual(["Bor"]);
  });

  it("on a phone, a user without a column starts on the first column", () => {
    isPhone.mockReturnValue(true);
    me.mockReturnValue(businessMe(5, "STAFF", true));
    const view = deskView();
    view.days[0].columns = view.days[0].columns.map((c) => ({ ...c, isMe: false }));
    answer(view);
    renderDesk();
    expect(headers()).toEqual(["Olga"]);
  });

  it("when business.me says no business, shows the load error with a retry of business.me, no grid", () => {
    me.mockReturnValue({ status: "none", me: null });
    renderDesk();
    expect(screen.getByText("Koledarja ni bilo mogoče naložiti.")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^desk-column-header-/)).toHaveLength(0);
    expect(screen.queryByTestId("desk-actor-chip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(deskTrpc.refetchMe).toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("shows a loading text and an error with a retry", () => {
    answer(undefined);
    renderDesk();
    expect(screen.getByText("Nalaganje...")).toBeInTheDocument();
    cleanup();
    answer(undefined, { isPending: false, error: new Error("x") });
    renderDesk();
    expect(screen.getByText("Koledarja ni bilo mogoče naložiti.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(refetch).toHaveBeenCalled();
  });
});

// Flowko U28 (Task 7): the sheets open from taps; move mode (R12) survives a date change.
describe("DeskView sheets and move mode (U28 R10, R12)", () => {
  const yOf = (hm: string, date?: string) => ((at(hm, date) - at("08:00", date)) / 60_000) * 2;
  const column = (memberId: number) => screen.getByTestId(`desk-column-${memberId}`);
  const banner = () => screen.queryByTestId("desk-move-banner");

  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
    toast.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("flowko-desk-actor:9", String(OLGA));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    isPhone.mockReturnValue(false);
    me.mockReturnValue(businessMe(OLGA, "OWNER", true));
    dayQuery.mockImplementation((input: { date: string }) => ({
      data: deskView({}, input.date),
      dataUpdatedAt: NOW.getTime(),
      refetch,
      isPending: false,
      error: null,
    }));
    deskTrpc.move.mockResolvedValue({ status: "moved", bookingId: 101, uid: "u" });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  function openBarvanje() {
    fireEvent.click(
      screen.getByTestId("desk-booking-101").querySelector('[data-kind="busy"]') as HTMLElement
    );
    return screen.getByRole("dialog", { name: "Barvanje" });
  }

  it("a tap on an empty spot opens the booking sheet with that worker and time", () => {
    renderDesk();
    fireEvent.click(column(BOR), { clientY: yOf("13:30") });
    expect(screen.getByRole("dialog", { name: "Nov termin" })).toBeInTheDocument();
    expect(screen.getByTestId("desk-sheet-worker").textContent).toContain("Bor");
    expect((screen.getByLabelText("Čas") as HTMLInputElement).value).toBe("13:30");
  });

  it("a WORKER's tap on a colleague's column opens no sheet; her own column does (R5)", () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", true));
    dayQuery.mockImplementation((input: { date: string }) => {
      const view = deskView({}, input.date);
      view.me = { memberId: ANA, role: "WORKER" };
      view.days[0].columns = view.days[0].columns.map((c) => ({ ...c, isMe: c.memberId === ANA }));
      return { data: view, dataUpdatedAt: NOW.getTime(), refetch, isPending: false, error: null };
    });
    renderDesk();
    expect(column(BOR)).not.toHaveAttribute("data-tap");
    fireEvent.click(column(BOR), { clientY: yOf("13:30") });
    expect(screen.queryByRole("dialog", { name: "Nov termin" })).toBeNull();
    expect(column(ANA)).toHaveAttribute("data-tap", "book");
    fireEvent.click(column(ANA), { clientY: yOf("11:00") });
    expect(screen.getByRole("dialog", { name: "Nov termin" })).toBeInTheDocument();
  });

  it("a tap on a booking opens its details", () => {
    renderDesk();
    expect(openBarvanje()).toBeInTheDocument();
  });

  it("„Prestavi“: banner, other columns dimmed, a tap elsewhere ignored, a tap in the column moves", async () => {
    renderDesk();
    openBarvanje();
    startCalendarMove();
    expect(screen.queryByRole("dialog", { name: "Barvanje" })).toBeNull();
    expect(banner()?.textContent).toContain("Kliknite nov čas v stolpcu: Ana");
    expect(column(BOR)).toHaveAttribute("data-dimmed", "true");
    expect(column(ANA)).not.toHaveAttribute("data-dimmed");
    fireEvent.click(column(BOR), { clientY: yOf("13:30") });
    expect(deskTrpc.move).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Nov termin" })).toBeNull();
    fireEvent.click(column(ANA), { clientY: yOf("11:00") });
    await waitFor(() =>
      expect(deskTrpc.move).toHaveBeenCalledWith({
        bookingId: 101,
        start: iso("11:00"),
        confirmOverride: false,
        actorMemberId: OLGA,
      })
    );
    await waitFor(() => expect(banner()).toBeNull());
    expect(toast).toHaveBeenCalledWith("Termin je prestavljen.", "success");
  });

  // Flowko U28c (review): no worker name to show → the banner names the booking's customer, never ends in „: “.
  it("move banner without a worker name names the booking's customer", () => {
    const unnamed = (date: string) => {
      const v = deskView({}, date);
      return {
        ...v,
        days: v.days.map((d) => ({
          ...d,
          columns: d.columns.map((c) => (c.memberId === ANA ? { ...c, displayName: "" } : c)),
        })),
      };
    };
    dayQuery.mockImplementation((input: { date: string }) => ({
      data: unnamed(input.date),
      dataUpdatedAt: NOW.getTime(),
      refetch,
      isPending: false,
      error: null,
    }));
    deskTrpc.membersQuery.mockReturnValue({
      data: [
        { memberId: OLGA, displayName: "Olga", role: "OWNER", hasColumn: true, deskOnly: false },
        { memberId: BOR, displayName: "Bor", role: "WORKER", hasColumn: true, deskOnly: false },
      ],
    });
    renderDesk();
    openBarvanje();
    startCalendarMove();
    expect(banner()?.textContent).toContain("Izberite nov čas za termin: Marija Novak");
    expect(banner()?.textContent).not.toContain("v stolpcu");
  });

  it("move mode stays on the next day and a tap there moves to that day", async () => {
    renderDesk();
    openBarvanje();
    startCalendarMove();
    fireEvent.click(screen.getByRole("button", { name: "Naslednji dan" }));
    await waitFor(() => expect(requestedDates()).toContain("2026-11-17"));
    expect(banner()).not.toBeNull();
    fireEvent.click(column(ANA), { clientY: yOf("11:00", "2026-11-17") });
    await waitFor(() =>
      expect(deskTrpc.move).toHaveBeenCalledWith(
        expect.objectContaining({ start: iso("11:00", "2026-11-17") })
      )
    );
  });

  it("in move mode a tap on the moving booking's own busy segment moves it to that grid start (R12: „15 min later“)", async () => {
    renderDesk();
    openBarvanje();
    startCalendarMove();
    const ownBusy = screen.getByTestId("desk-booking-101").querySelector('[data-kind="busy"]') as HTMLElement;
    expect(ownBusy.style.pointerEvents).toBe("none");
    fireEvent.click(ownBusy, { clientY: yOf("09:15") + 1 });
    await waitFor(() =>
      expect(deskTrpc.move).toHaveBeenCalledWith({
        bookingId: 101,
        start: iso("09:15"),
        confirmOverride: false,
        actorMemberId: OLGA,
      })
    );
    expect(screen.queryByRole("dialog", { name: "Barvanje" })).toBeNull();
  });

  it("outside move mode a busy segment takes the tap and opens the details, no booking sheet", () => {
    renderDesk();
    const busy = screen.getByTestId("desk-booking-101").querySelector('[data-kind="busy"]') as HTMLElement;
    expect(busy.style.pointerEvents).toBe("auto");
    fireEvent.click(busy, { clientY: yOf("09:15") + 1 });
    expect(screen.getByRole("dialog", { name: "Barvanje" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Nov termin" })).toBeNull();
    expect(deskTrpc.move).not.toHaveBeenCalled();
  });

  it("on a phone in move mode the single column is the moving booking's worker (R12, R15)", () => {
    isPhone.mockReturnValue(true);
    renderDesk("?worker=2");
    expect(headers()).toEqual(["Ana"]);
    openBarvanje();
    startCalendarMove();
    fireEvent.change(screen.getByLabelText("Delavec"), { target: { value: String(BOR) } });
    expect(headers()).toEqual(["Ana"]);
    expect((screen.getByLabelText("Delavec") as HTMLSelectElement).value).toBe(String(ANA));
    fireEvent.click(screen.getByRole("button", { name: "Prekliči" }));
    expect(headers()).toEqual(["Bor"]);
  });

  it("„Prekliči“ and Esc leave move mode; a booking tap opens nothing while moving", () => {
    renderDesk();
    openBarvanje();
    startCalendarMove();
    fireEvent.click(
      screen.getByTestId("desk-booking-102").querySelector('[data-kind="busy"]') as HTMLElement
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Prekliči" }));
    expect(banner()).toBeNull();
    openBarvanje();
    startCalendarMove();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(banner()).toBeNull();
  });

  it("a move that needs confirming refetches the day, then shows the dialog", async () => {
    deskTrpc.move
      .mockResolvedValueOnce({
        status: "needs_confirm",
        problems: [{ kind: "outside_shift", step: 2 }],
        googleUnavailable: false,
      })
      .mockResolvedValueOnce({ status: "moved", bookingId: 101, uid: "u" });
    renderDesk();
    openBarvanje();
    startCalendarMove();
    fireEvent.click(column(ANA), { clientY: yOf("15:00") });
    const dialog = await screen.findByRole("dialog", { name: "Termin ni v skladu s pravili" });
    expect(refetch).toHaveBeenCalled();
    expect(dialog.textContent).toContain("Barvanje: zunaj izmene.");
    fireEvent.click(screen.getByRole("button", { name: "Vseeno shrani" }));
    await waitFor(() =>
      expect(deskTrpc.move).toHaveBeenLastCalledWith(expect.objectContaining({ confirmOverride: true }))
    );
    await waitFor(() => expect(banner()).toBeNull());
  });

  // Flowko U28c (M2): the move panel in the sheet goes through the same move path as the calendar.
  it("the move panel: „Potrdi prestavitev“ moves, toasts, closes the sheet", async () => {
    renderDesk();
    openBarvanje();
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
    fireEvent.change(screen.getByLabelText("Datum"), { target: { value: "2026-11-18" } });
    fireEvent.change(screen.getByLabelText("Čas"), { target: { value: "11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Potrdi prestavitev" }));
    await waitFor(() =>
      expect(deskTrpc.move).toHaveBeenCalledWith({
        bookingId: 101,
        start: iso("11:00", "2026-11-18"),
        confirmOverride: false,
        actorMemberId: OLGA,
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Barvanje" })).toBeNull());
    expect(toast).toHaveBeenCalledWith("Termin je prestavljen.", "success");
    expect(banner()).toBeNull();
  });

  it("the move panel: needs_confirm refetches, then the override dialog resends with confirmOverride", async () => {
    deskTrpc.move
      .mockResolvedValueOnce({
        status: "needs_confirm",
        problems: [{ kind: "outside_shift", step: 2 }],
        googleUnavailable: false,
      })
      .mockResolvedValueOnce({ status: "moved", bookingId: 101, uid: "u" });
    renderDesk();
    openBarvanje();
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
    fireEvent.change(screen.getByLabelText("Čas"), { target: { value: "15:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Potrdi prestavitev" }));
    const dialog = await screen.findByRole("dialog", { name: "Termin ni v skladu s pravili" });
    expect(refetch).toHaveBeenCalled();
    expect(dialog.textContent).toContain("Barvanje: zunaj izmene.");
    fireEvent.click(screen.getByRole("button", { name: "Vseeno shrani" }));
    await waitFor(() =>
      expect(deskTrpc.move).toHaveBeenLastCalledWith(
        expect.objectContaining({ start: iso("15:00"), confirmOverride: true })
      )
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Barvanje" })).toBeNull());
  });

  it("„Prestavi k drugemu delavcu“ opens the booking sheet for the same customer", () => {
    renderDesk();
    openBarvanje();
    fireEvent.click(screen.getByRole("button", { name: "Prestavi k drugemu delavcu" }));
    expect(screen.getByRole("dialog", { name: "Prestavi k drugemu delavcu" })).toBeInTheDocument();
    // Flowko U28b (B2): the old booking's customer shows as the card.
    expect(screen.getByTestId("desk-customer-card").textContent).toContain("Marija Novak");
  });
});

// Flowko U28 (Task 8, D2): the week view: one worker x seven days from md up.
describe("DeskView week view (U28 D2)", () => {
  const weekQuery = deskTrpc.weekQuery;
  const weekRefetch = vi.fn();
  const weekStarts = () => weekQuery.mock.calls.map((c) => (c[0] as { weekStart: string }).weekStart);
  const weekMembers = () => weekQuery.mock.calls.map((c) => (c[0] as { memberId: number }).memberId);
  const wcol = (date: string) => screen.getByTestId(`desk-column-${date}`);
  const yOf = (hm: string, date: string) => ((at(hm, date) - at("08:00", date)) / 60_000) * 2;
  const banner = () => screen.queryByTestId("desk-move-banner");

  function answerWeek(over: { now?: string; updatedAt?: number } = {}) {
    weekQuery.mockImplementation((input: { weekStart: string; memberId: number }) => ({
      data: { ...weekViewOf(input.memberId, input.weekStart), ...(over.now && { now: over.now }) },
      dataUpdatedAt: over.updatedAt ?? NOW.getTime(),
      refetch: weekRefetch,
      isPending: false,
      error: null,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
    toast.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("flowko-desk-actor:9", String(OLGA));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    isPhone.mockReturnValue(false);
    me.mockReturnValue(businessMe(OLGA, "OWNER", true));
    answer(deskView());
    answerWeek();
    deskTrpc.move.mockResolvedValue({ status: "moved", bookingId: 101, uid: "u" });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("asks bookings.week for the worker and the Monday of the date's week (polling like the day)", () => {
    renderDesk("?view=week&worker=2&date=2026-11-18");
    expect(weekQuery).toHaveBeenCalledWith(
      { weekStart: "2026-11-16", memberId: ANA },
      expect.objectContaining({ refetchInterval: 30000, refetchOnWindowFocus: true, enabled: true })
    );
    expect(screen.getAllByTestId(/^desk-week-header-/)).toHaveLength(7);
    expect(screen.getAllByTestId("desk-booking-201")).toHaveLength(1);
    // the day query stays off while the week is shown
    expect(dayQuery).toHaveBeenCalledWith(
      { date: "2026-11-18" },
      expect.objectContaining({ enabled: false })
    );
  });

  it("takes the Monday in the business zone: Sunday 23:30 UTC is Monday in Ljubljana", () => {
    vi.setSystemTime(new Date("2026-11-15T23:30:00Z"));
    answerWeek({ now: "2026-11-15T23:30:00.000Z", updatedAt: Date.now() });
    renderDesk("?view=week");
    // the browser (TZ=UTC) first guesses Sunday 15th (week of the 9th), then the server's clock says Monday 16th
    expect(weekStarts()[0]).toBe("2026-11-09");
    expect(weekStarts()[weekStarts().length - 1]).toBe("2026-11-16");
    expect(screen.getByTestId("desk-week-header-2026-11-16")).toHaveAttribute("data-today", "true");
  });

  it("takes the Monday from the date, not the browser's or a profile's week start (Sunday belongs to the week before)", () => {
    renderDesk("?view=week&worker=2&date=2026-11-22");
    expect(Array.from(new Set(weekStarts()))).toEqual(["2026-11-16"]);
    cleanup();
    weekQuery.mockClear();
    renderDesk("?view=week&worker=2&date=2026-11-16");
    expect(Array.from(new Set(weekStarts()))).toEqual(["2026-11-16"]);
  });

  it("defaults to the user's own column, else the first worker with a column", () => {
    renderDesk("?view=week");
    expect(Array.from(new Set(weekMembers()))).toEqual([OLGA]);
    expect(screen.getByRole("radio", { name: "Olga" })).toHaveAttribute("aria-checked", "true");
    cleanup();
    weekQuery.mockClear();
    me.mockReturnValue(businessMe(5, "STAFF", true));
    renderDesk("?view=week");
    expect(Array.from(new Set(weekMembers()))).toEqual([OLGA]);
    cleanup();
    weekQuery.mockClear();
    me.mockReturnValue(businessMe(ANA, "WORKER", true));
    renderDesk("?view=week");
    expect(Array.from(new Set(weekMembers()))).toEqual([ANA]);
  });

  it("ignores a ?worker= without a column and falls back to the default", () => {
    renderDesk("?view=week&worker=99");
    expect(Array.from(new Set(weekMembers()))).toEqual([OLGA]);
  });

  it("the worker picker lists the workers with a column and switches the week to one of them", async () => {
    const urls: UrlUpdateEvent[] = [];
    renderDesk("?view=week", (e) => urls.push(e));
    const radios = screen
      .getAllByRole("radio")
      .filter((r) => ["Olga", "Ana", "Bor", "Cene"].includes(r.textContent ?? ""));
    expect(radios.map((r) => r.textContent)).toEqual(["Olga", "Ana", "Bor", "Cene"]);
    expect(screen.queryByRole("radio", { name: "Rok" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Bor" }));
    await waitFor(() => expect(weekMembers()[weekMembers().length - 1]).toBe(BOR));
    await waitFor(() => expect(urls[urls.length - 1]?.queryString).toContain("worker=3"));
  });

  it("a tap on a day header opens that day's day view", async () => {
    const urls: UrlUpdateEvent[] = [];
    renderDesk("?view=week&worker=2&date=2026-11-18", (e) => urls.push(e));
    fireEvent.click(screen.getByTestId("desk-week-header-2026-11-19"));
    await waitFor(() => expect(requestedDates()).toContain("2026-11-19"));
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    const last = urls[urls.length - 1].queryString;
    expect(last).toContain("date=2026-11-19");
    expect(last).not.toContain("view=week");
    expect(screen.queryByTestId("desk-week-header-2026-11-19")).toBeNull();
    expect(screen.getAllByTestId(/^desk-column-header-/).length).toBeGreaterThan(0);
  });

  it("a tap on today's header goes to the day view without a date in the URL", async () => {
    const urls: UrlUpdateEvent[] = [];
    renderDesk("?view=week&worker=2&date=2026-11-18", (e) => urls.push(e));
    fireEvent.click(screen.getByTestId("desk-week-header-2026-11-16"));
    await waitFor(() => expect(screen.queryByTestId("desk-week-header-2026-11-16")).toBeNull());
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls[urls.length - 1].queryString).toBe("?worker=2");
  });

  it("a tap on an empty spot opens the booking sheet for that worker and day", () => {
    renderDesk("?view=week&worker=2&date=2026-11-18");
    fireEvent.click(wcol("2026-11-19"), { clientY: yOf("13:30", "2026-11-19") });
    expect(screen.getByRole("dialog", { name: "Nov termin" })).toBeInTheDocument();
    expect(screen.getByTestId("desk-sheet-worker").textContent).toContain("Ana");
    expect((screen.getByLabelText("Datum") as HTMLInputElement).value).toBe("2026-11-19");
    expect((screen.getByLabelText("Čas") as HTMLInputElement).value).toBe("13:30");
  });

  it("a WORKER viewing a colleague's week cannot tap; her own week she can (R5)", () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", true));
    answerWeek();
    weekQuery.mockImplementation((input: { weekStart: string; memberId: number }) => {
      const view = weekViewOf(input.memberId, input.weekStart);
      view.me = { memberId: ANA, role: "WORKER" };
      view.days.forEach((d) => d.columns.forEach((c) => (c.isMe = c.memberId === ANA)));
      return {
        data: view,
        dataUpdatedAt: NOW.getTime(),
        refetch: weekRefetch,
        isPending: false,
        error: null,
      };
    });
    renderDesk("?view=week&worker=3&date=2026-11-18");
    expect(wcol("2026-11-19")).not.toHaveAttribute("data-tap");
    fireEvent.click(wcol("2026-11-19"), { clientY: yOf("13:30", "2026-11-19") });
    expect(screen.queryByRole("dialog", { name: "Nov termin" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Ana" }));
    expect(wcol("2026-11-19")).toHaveAttribute("data-tap", "book");
  });

  it("in move mode a tap on another day of the moving booking's worker moves it there", async () => {
    renderDesk("?view=week&worker=2&date=2026-11-16");
    fireEvent.click(
      screen.getByTestId("desk-booking-101").querySelector('[data-kind="busy"]') as HTMLElement
    );
    startCalendarMove();
    expect(banner()?.textContent).toContain("Kliknite nov čas v stolpcu: Ana");
    expect(wcol("2026-11-19")).not.toHaveAttribute("data-dimmed");
    fireEvent.click(wcol("2026-11-19"), { clientY: yOf("11:00", "2026-11-19") });
    await waitFor(() =>
      expect(deskTrpc.move).toHaveBeenCalledWith({
        bookingId: 101,
        start: iso("11:00", "2026-11-19"),
        confirmOverride: false,
        actorMemberId: OLGA,
      })
    );
    await waitFor(() => expect(banner()).toBeNull());
    expect(deskTrpc.invalidateWeek).toHaveBeenCalled();
  });

  it("in move mode another worker's week is dimmed and its taps are ignored", () => {
    renderDesk("?view=week&worker=2&date=2026-11-16");
    fireEvent.click(
      screen.getByTestId("desk-booking-101").querySelector('[data-kind="busy"]') as HTMLElement
    );
    startCalendarMove();
    fireEvent.click(screen.getByRole("radio", { name: "Bor" }));
    expect(banner()).not.toBeNull();
    expect(wcol("2026-11-19")).toHaveAttribute("data-dimmed", "true");
    fireEvent.click(wcol("2026-11-19"), { clientY: yOf("11:00", "2026-11-19") });
    expect(deskTrpc.move).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Nov termin" })).toBeNull();
  });

  it("move mode survives the switch from the day view to the week, and shows that worker's week", async () => {
    renderDesk("");
    fireEvent.click(
      screen.getByTestId("desk-booking-101").querySelector('[data-kind="busy"]') as HTMLElement
    );
    startCalendarMove();
    fireEvent.click(screen.getByRole("radio", { name: "Teden" }));
    await waitFor(() => expect(screen.getAllByTestId(/^desk-week-header-/)).toHaveLength(7));
    expect(banner()).not.toBeNull();
    expect(weekMembers()[weekMembers().length - 1]).toBe(ANA);
    fireEvent.click(wcol("2026-11-20"), { clientY: yOf("15:00", "2026-11-20") });
    await waitFor(() =>
      expect(deskTrpc.move).toHaveBeenCalledWith(
        expect.objectContaining({ start: iso("15:00", "2026-11-20") })
      )
    );
  });

  it("a write that needs confirming refetches the WEEK before the dialog shows (R13)", async () => {
    deskTrpc.move.mockResolvedValueOnce({
      status: "needs_confirm",
      problems: [{ kind: "outside_shift", step: 0 }],
      googleUnavailable: false,
    });
    renderDesk("?view=week&worker=2&date=2026-11-16");
    fireEvent.click(
      screen.getByTestId("desk-booking-101").querySelector('[data-kind="busy"]') as HTMLElement
    );
    startCalendarMove();
    fireEvent.click(wcol("2026-11-19"), { clientY: yOf("15:30", "2026-11-19") });
    await screen.findByRole("dialog", { name: "Termin ni v skladu s pravili" });
    expect(weekRefetch).toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("on a phone the week view is not offered: the day view, the toggle disabled with a hint", () => {
    isPhone.mockReturnValue(true);
    renderDesk("?view=week&worker=2");
    expect(screen.queryByTestId(/^desk-week-header-/)).toBeNull();
    expect(screen.getByLabelText("Delavec")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Teden" })).toBeDisabled();
    expect(screen.getByTestId("desk-week-hint")).toBeInTheDocument();
    expect(weekQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });

  it("shows a loading text, and an error with a retry that refetches the week", () => {
    weekQuery.mockReturnValue({
      data: undefined,
      dataUpdatedAt: 0,
      refetch: weekRefetch,
      isPending: true,
      error: null,
    });
    renderDesk("?view=week");
    expect(screen.getByText("Nalaganje...")).toBeInTheDocument();
    cleanup();
    weekQuery.mockReturnValue({
      data: undefined,
      dataUpdatedAt: 0,
      refetch: weekRefetch,
      isPending: false,
      error: new Error("x"),
    });
    renderDesk("?view=week");
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(weekRefetch).toHaveBeenCalled();
  });

  it("with no worker that has a column it says so instead of loading forever", () => {
    weekQuery.mockReturnValue({
      data: undefined,
      dataUpdatedAt: 0,
      refetch: weekRefetch,
      isPending: true,
      error: null,
    });
    deskTrpc.membersQuery.mockReturnValue({
      data: [{ memberId: 5, displayName: "Rok", role: "STAFF", hasColumn: false, deskOnly: false }],
    });
    renderDesk("?view=week");
    expect(screen.getByText("Delavcev še ni.")).toBeInTheDocument();
  });
});

// Flowko U28b (B1, B3): „Kdo ste?“ is optional: the signed-in member acts unless this device chose someone else;
// every desk write refreshes the free starts with the day and week.
describe("DeskView who acts, free starts (U28b B1, B3)", () => {
  const yOf = (hm: string) => ((at(hm) - at("08:00")) / 60_000) * 2;
  const column = (memberId: number) => screen.getByTestId(`desk-column-${memberId}`);
  const chipButton = () => screen.getByTestId("desk-actor-chip");
  // The Cal dialog carries no accessible name, so the picker is found by its options.
  const pickerOptions = () => screen.queryAllByTestId(/^desk-actor-option-/);

  async function bookFenAtBor() {
    fireEvent.click(column(BOR), { clientY: yOf("13:30") });
    const sheet = screen.getByRole("dialog", { name: "Nov termin" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Fen" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Nova stranka" }));
    fireEvent.change(within(sheet).getByLabelText("Ime in priimek"), { target: { value: "Marija Novak" } });
    fireEvent.change(within(sheet).getByLabelText("Telefon"), { target: { value: "041 123 456" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Shrani" }));
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalled());
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
    toast.mockReset();
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    isPhone.mockReturnValue(false);
    me.mockReturnValue(businessMe(OLGA, "OWNER", true));
    answer(deskView());
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 7, uid: "u" });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("an OWNER with no stored choice books as herself; no picker opens; free starts are invalidated", async () => {
    renderDesk();
    expect(chipButton().textContent).toBe("Ste: Olga");
    await bookFenAtBor();
    expect(deskTrpc.create).toHaveBeenCalledWith(expect.objectContaining({ actorMemberId: OLGA }));
    expect(pickerOptions()).toHaveLength(0);
    await waitFor(() => expect(deskTrpc.invalidateFreeStarts).toHaveBeenCalled());
    expect(deskTrpc.invalidateDay).toHaveBeenCalled();
    expect(deskTrpc.invalidateWeek).toHaveBeenCalled();
  });

  it("the chip opens the picker; choosing Cene stores her and later writes name her; choosing herself resets", async () => {
    renderDesk();
    expect(pickerOptions()).toHaveLength(0);
    fireEvent.click(chipButton());
    expect(screen.getByText("Kdo ste?")).toBeInTheDocument();
    expect(pickerOptions().map((o) => o.textContent)).toEqual(["Olga", "Ana", "Bor", "Cene", "Rok"]);
    fireEvent.click(screen.getByTestId(`desk-actor-option-${CENE}`));
    expect(window.localStorage.getItem("flowko-desk-actor:9")).toBe(String(CENE));
    expect(chipButton().textContent).toBe("Ste: Cene");
    await bookFenAtBor();
    expect(deskTrpc.create).toHaveBeenLastCalledWith(expect.objectContaining({ actorMemberId: CENE }));

    fireEvent.click(chipButton());
    fireEvent.click(screen.getByTestId(`desk-actor-option-${OLGA}`));
    expect(window.localStorage.getItem("flowko-desk-actor:9")).toBeNull();
    expect(chipButton().textContent).toBe("Ste: Olga");
  });

  it("a stored member who is no longer active falls back to the signed-in member", () => {
    window.localStorage.setItem("flowko-desk-actor:9", "77");
    renderDesk();
    expect(chipButton().textContent).toBe("Ste: Olga");
  });

  it("forbidden clears the stored choice and shows its text, no picker", async () => {
    window.localStorage.setItem("flowko-desk-actor:9", String(CENE));
    deskTrpc.create.mockRejectedValue(Object.assign(new Error("forbidden"), { data: { code: "FORBIDDEN" } }));
    renderDesk();
    expect(chipButton().textContent).toBe("Ste: Cene");
    await bookFenAtBor();
    expect(deskTrpc.create).toHaveBeenCalledWith(expect.objectContaining({ actorMemberId: CENE }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Za to nimate dovoljenja. Izbira osebe je ponastavljena; poskusite znova.",
        "error"
      )
    );
    expect(window.localStorage.getItem("flowko-desk-actor:9")).toBeNull();
    expect(chipButton().textContent).toBe("Ste: Olga");
    expect(pickerOptions()).toHaveLength(0);
  });

  it("a WORKER's chip is fixed to herself and not a button", () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", true));
    window.localStorage.setItem("flowko-desk-actor:9", String(BOR));
    renderDesk();
    expect(chipButton().textContent).toBe("Ste: Ana");
    expect(chipButton().tagName).toBe("SPAN");
  });
});

// Flowko U29a (S7, Review Focus 4): with the owner's „shared device“ switch off the desk shows no chip for any role,
// removes a stored choice in an effect, every write names the signed-in member, and OWNER/STAFF still book every
// column (rights come from the role, not the chip).
describe("DeskView with the shared device switch off (U29a S7)", () => {
  const yOf = (hm: string) => ((at(hm) - at("08:00")) / 60_000) * 2;
  const column = (memberId: number) => screen.getByTestId(`desk-column-${memberId}`);
  const columnIds = [OLGA, ANA, BOR, CENE];

  async function bookFenAt(memberId: number) {
    fireEvent.click(column(memberId), { clientY: yOf("13:30") });
    const sheet = screen.getByRole("dialog", { name: "Nov termin" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Fen" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Nova stranka" }));
    fireEvent.change(within(sheet).getByLabelText("Ime in priimek"), { target: { value: "Marija Novak" } });
    fireEvent.change(within(sheet).getByLabelText("Telefon"), { target: { value: "041 123 456" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Shrani" }));
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalled());
  }

  function answerAs(memberId: number, role: "OWNER" | "STAFF" | "WORKER") {
    const view = deskView();
    view.me = { memberId, role };
    view.days[0].columns = view.days[0].columns.map((c) => ({ ...c, isMe: c.memberId === memberId }));
    answer(view);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
    toast.mockReset();
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    isPhone.mockReturnValue(false);
    me.mockReturnValue(businessMe(OLGA, "OWNER", false));
    answer(deskView());
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 7, uid: "u" });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it.each([
    ["OWNER", OLGA],
    ["STAFF", 5],
    ["WORKER", ANA],
  ] as const)("a %s session sees no actor chip and no picker", (role, memberId) => {
    me.mockReturnValue(businessMe(memberId, role, false));
    answerAs(memberId, role);
    renderDesk();
    expect(screen.getAllByTestId(/^desk-column-header-/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("desk-actor-chip")).toBeNull();
    expect(screen.queryByText(/^Ste: /)).toBeNull();
    expect(screen.queryAllByTestId(/^desk-actor-option-/)).toHaveLength(0);
  });

  // Flowko U29a (final review): a tablet left open on /koledar follows a switch saved on another device: `me` polls
  // with the desk (useDeskBusinessMePoll; the polling itself is proven in useDeskData.test.tsx), and a refetched
  // answer with the switch off removes the chip in the same mount.
  it("polls business.me with the desk and drops the chip when a refetch turns the switch off", async () => {
    me.mockReturnValue(businessMe(OLGA, "OWNER", true));
    const { rerender } = renderDesk();
    expect(deskTrpc.meQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ refetchInterval: 30000, refetchOnWindowFocus: true })
    );
    expect(screen.getByTestId("desk-actor-chip").textContent).toBe("Ste: Olga");
    me.mockReturnValue(businessMe(OLGA, "OWNER", false));
    rerender(deskTree());
    await waitFor(() => expect(screen.queryByTestId("desk-actor-chip")).toBeNull());
    expect(screen.getAllByTestId(/^desk-column-header-/).length).toBeGreaterThan(0);
  });

  it("removes a stored choice of this business (in an effect) and keeps another business's", async () => {
    window.localStorage.setItem("flowko-desk-actor:9", String(CENE));
    window.localStorage.setItem("flowko-desk-actor:8", String(BOR));
    renderDesk();
    await waitFor(() => expect(window.localStorage.getItem("flowko-desk-actor:9")).toBeNull());
    expect(window.localStorage.getItem("flowko-desk-actor:8")).toBe(String(BOR));
  });

  it("an OWNER with a stale stored choice writes as herself", async () => {
    window.localStorage.setItem("flowko-desk-actor:9", String(CENE));
    renderDesk();
    await bookFenAt(BOR);
    expect(deskTrpc.create).toHaveBeenCalledWith(expect.objectContaining({ actorMemberId: OLGA }));
  });

  it("a STAFF session writes as herself (Rok)", async () => {
    me.mockReturnValue(businessMe(5, "STAFF", false));
    answerAs(5, "STAFF");
    window.localStorage.setItem("flowko-desk-actor:9", String(OLGA));
    renderDesk();
    await bookFenAt(ANA);
    expect(deskTrpc.create).toHaveBeenCalledWith(expect.objectContaining({ actorMemberId: 5 }));
  });

  it.each([
    ["OWNER", OLGA],
    ["STAFF", 5],
  ] as const)("an %s session still books every column (Review Focus 4)", (role, memberId) => {
    me.mockReturnValue(businessMe(memberId, role, false));
    answerAs(memberId, role);
    renderDesk();
    for (const id of columnIds) expect(column(id)).toHaveAttribute("data-tap", "book");
    fireEvent.click(column(BOR), { clientY: yOf("13:30") });
    expect(screen.getByRole("dialog", { name: "Nov termin" })).toBeInTheDocument();
    expect(screen.getByTestId("desk-sheet-worker").textContent).toContain("Bor");
  });

  it("a WORKER still books only her own column", () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", false));
    answerAs(ANA, "WORKER");
    renderDesk();
    expect(column(ANA)).toHaveAttribute("data-tap", "book");
    expect(column(BOR)).not.toHaveAttribute("data-tap");
  });
});

// Flowko U29b (S1, S13): „Urnik“ is the third desk view on every size (?view=roster, ?rosterMode=week|usual). The
// day/week reads stop, the chip hides, move mode ends; „today“ comes from roster.week; the draft lives in DeskView
// (kept across a resize and inside the week) and leaving the week, the view or the mode asks first.
describe("U29b Urnik routing", () => {
  const rosterQuery = deskTrpc.rosterWeekQuery;
  const rosterWeeks = () => rosterQuery.mock.calls.map((c) => (c[0] as { weekStart: string }).weekStart);
  const probe = () => JSON.parse(screen.getByTestId("probe-state").textContent ?? "{}");
  const unsaved = () => screen.queryByRole("dialog", { name: "Neshranjene spremembe" });

  function answerRoster(over: Partial<RosterWeekView> = {}) {
    rosterQuery.mockImplementation((input: { weekStart: string }) => ({
      data: rosterWeek({ weekStart: input.weekStart, ...over }),
      isPending: false,
      error: null,
      refetch: vi.fn(),
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
    toast.mockReset();
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    isPhone.mockReturnValue(false);
    me.mockReturnValue(businessMe(OLGA, "OWNER", true));
    rosterProbe.on = false;
    dayQuery.mockImplementation((input: { date: string }) => ({
      data: deskView({}, input.date),
      dataUpdatedAt: NOW.getTime(),
      refetch,
      isPending: false,
      error: null,
    }));
    answerRoster();
  });
  afterEach(() => {
    rosterProbe.on = false;
    vi.useRealTimers();
    cleanup();
  });

  it("the toggle offers „Urnik“ on a desktop and on a phone, and choosing it puts view=roster in the URL", async () => {
    const urls: UrlUpdateEvent[] = [];
    renderDesk("", (e) => urls.push(e));
    expect(screen.getByRole("radio", { name: "Urnik" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Urnik" }));
    await waitFor(() => expect(urls[urls.length - 1]?.queryString).toContain("view=roster"));
    expect(await screen.findByTestId("roster-view")).toBeInTheDocument();
    cleanup();
    isPhone.mockReturnValue(true);
    renderDesk();
    expect(screen.getByRole("radio", { name: "Urnik" })).not.toBeDisabled();
  });

  it("?view=roster renders Urnik on a phone too (no fallback to the day view)", () => {
    isPhone.mockReturnValue(true);
    renderDesk("?view=roster");
    expect(screen.getByTestId("roster-view")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Urnik" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryAllByTestId(/^desk-column-header-/)).toHaveLength(0);
    expect(screen.queryByLabelText("Delavec")).toBeNull();
  });

  it("asks roster.week for the Monday of the date's week; the day and week reads are off", () => {
    renderDesk("?view=roster&date=2026-11-19");
    expect(rosterQuery).toHaveBeenCalledWith(
      { weekStart: "2026-11-16" },
      expect.objectContaining({ enabled: true, refetchInterval: 30000 })
    );
    expect(dayQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    expect(deskTrpc.weekQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
    expect(dayQuery).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: true }));
    expect(screen.queryAllByTestId(/^desk-column-header-/)).toHaveLength(0);
  });

  it("outside Urnik roster.week stays off", () => {
    renderDesk();
    expect(rosterQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    expect(rosterQuery).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: true })
    );
  });

  it("hides the actor chip (roster writes record the signed-in user)", () => {
    renderDesk("?view=roster");
    expect(screen.queryByTestId("desk-actor-chip")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ste: Olga" })).toBeNull();
  });

  it("entering Urnik stops move mode", async () => {
    window.localStorage.setItem("flowko-desk-actor:9", String(OLGA));
    renderDesk();
    fireEvent.click(
      screen.getByTestId("desk-booking-101").querySelector('[data-kind="busy"]') as HTMLElement
    );
    startCalendarMove();
    expect(screen.getByTestId("desk-move-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Urnik" }));
    await screen.findByTestId("roster-view");
    expect(screen.queryByTestId("desk-move-banner")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Dan" }));
    await waitFor(() => expect(screen.queryByTestId("roster-view")).toBeNull());
    expect(screen.queryByTestId("desk-move-banner")).toBeNull();
  });

  it("week mode on a desktop: week arrows and the week label; on a phone: day arrows and the day label", () => {
    renderDesk("?view=roster&date=2026-11-18");
    expect(screen.getByRole("button", { name: "Prejšnji teden" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Naslednji teden" })).toBeInTheDocument();
    expect(screen.getByTestId("pick-date").textContent).toContain("16. november – 22. november 2026");
    cleanup();
    isPhone.mockReturnValue(true);
    renderDesk("?view=roster&date=2026-11-18");
    expect(screen.getByRole("button", { name: "Naslednji dan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Naslednji teden" })).toBeNull();
    expect(screen.getByTestId("pick-date").textContent).toContain("sreda, 18. november 2026");
  });

  it("usual mode: no week or day arrows, no date picker, no „Danes“; only the view toggle", () => {
    renderDesk("?view=roster&rosterMode=usual");
    expect(screen.queryByRole("button", { name: "Prejšnji teden" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Naslednji teden" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prejšnji dan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Naslednji dan" })).toBeNull();
    expect(screen.queryByTestId("pick-date")).toBeNull();
    expect(screen.queryByRole("button", { name: "Danes" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Urnik" })).toHaveAttribute("aria-checked", "true");
    cleanup();
    isPhone.mockReturnValue(true);
    renderDesk("?view=roster&rosterMode=usual");
    expect(screen.queryByRole("button", { name: "Naslednji dan" })).toBeNull();
    expect(screen.queryByTestId("pick-date")).toBeNull();
  });

  it("a WORKER on ?rosterMode=usual gets the week mode (the usual week is the owner's)", () => {
    rosterProbe.on = true;
    me.mockReturnValue(businessMe(ANA, "WORKER", false));
    renderDesk("?view=roster&rosterMode=usual");
    expect(probe().mode).toBe("week");
    expect(screen.getByRole("button", { name: "Naslednji teden" })).toBeInTheDocument();
  });

  it("today comes from roster.week: browser on Sunday 15th 23:30 UTC, business Monday 16th", () => {
    rosterProbe.on = true;
    vi.setSystemTime(new Date("2026-11-15T23:30:00Z"));
    answerRoster({ today: "2026-11-16" });
    renderDesk("?view=roster");
    // the browser (TZ=UTC) first guesses Sunday 15th (week of the 9th), then roster.week's today says the 16th
    expect(rosterWeeks()[0]).toBe("2026-11-09");
    expect(rosterWeeks()[rosterWeeks().length - 1]).toBe("2026-11-16");
    expect(screen.getByRole("button", { name: "Danes" })).toBeDisabled();
    expect(screen.getByTestId("pick-date").textContent).toContain("16. november – 22. november 2026");
    expect(probe()).toMatchObject({ today: "2026-11-16", date: "2026-11-16", weekStart: "2026-11-16" });
  });

  it("a dirty draft survives a resize phone ↔ desktop, and pauses the roster poll", () => {
    rosterProbe.on = true;
    const { rerender } = renderDesk("?view=roster");
    fireEvent.click(screen.getByRole("button", { name: "probe-edit" }));
    expect(probe().changed).toBe(1);
    expect(rosterQuery).toHaveBeenLastCalledWith(
      { weekStart: "2026-11-16" },
      expect.objectContaining({ refetchInterval: false, refetchOnWindowFocus: false })
    );
    isPhone.mockReturnValue(true);
    rerender(deskTree("?view=roster"));
    expect(probe()).toMatchObject({ isPhone: true, changed: 1 });
    isPhone.mockReturnValue(false);
    rerender(deskTree("?view=roster"));
    expect(probe()).toMatchObject({ isPhone: false, changed: 1 });
  });

  it("dirty: a week arrow asks; „Ostani“ keeps the week and the draft", async () => {
    rosterProbe.on = true;
    renderDesk("?view=roster");
    fireEvent.click(screen.getByRole("button", { name: "probe-edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Naslednji teden" }));
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ostani" }));
    await waitFor(() => expect(unsaved()).toBeNull());
    expect(probe()).toMatchObject({ date: "2026-11-16", changed: 1 });
  });

  it("dirty: „Zavrzi in nadaljuj“ on a week arrow discards and moves to the next week", async () => {
    rosterProbe.on = true;
    const urls: UrlUpdateEvent[] = [];
    renderDesk("?view=roster", (e) => urls.push(e));
    fireEvent.click(screen.getByRole("button", { name: "probe-edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Naslednji teden" }));
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zavrzi in nadaljuj" }));
    await waitFor(() => expect(urls[urls.length - 1]?.queryString).toContain("date=2026-11-23"));
    await waitFor(() => expect(probe()).toMatchObject({ date: "2026-11-23", changed: 0 }));
  });

  it("dirty: Dan/Teden, the mode switch and a day-header tap ask first", async () => {
    rosterProbe.on = true;
    renderDesk("?view=roster");
    fireEvent.click(screen.getByRole("button", { name: "probe-edit" }));
    for (const ask of [
      () => fireEvent.click(screen.getByRole("radio", { name: "Dan" })),
      () => fireEvent.click(screen.getByRole("button", { name: "probe-usual" })),
      () => fireEvent.click(screen.getByRole("button", { name: "probe-open-day" })),
    ]) {
      ask();
      const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Ostani" }));
      await waitFor(() => expect(unsaved()).toBeNull());
      expect(screen.getByTestId("roster-view")).toBeInTheDocument();
      expect(probe()).toMatchObject({ mode: "week", changed: 1 });
    }
  });

  it("dirty: a day-header tap, discarded, opens Dan for that date", async () => {
    rosterProbe.on = true;
    const urls: UrlUpdateEvent[] = [];
    renderDesk("?view=roster", (e) => urls.push(e));
    fireEvent.click(screen.getByRole("button", { name: "probe-edit" }));
    fireEvent.click(screen.getByRole("button", { name: "probe-open-day" }));
    const dialog = await screen.findByRole("dialog", { name: "Neshranjene spremembe" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zavrzi in nadaljuj" }));
    await waitFor(() => expect(screen.queryByTestId("roster-view")).toBeNull());
    await waitFor(() => expect(urls[urls.length - 1]?.queryString).toContain("date=2026-11-18"));
    expect(urls[urls.length - 1]?.queryString).not.toContain("view=roster"); // "day" is the default: no param
  });

  it("clean: the mode switch runs at once (rosterMode=usual in the URL)", async () => {
    rosterProbe.on = true;
    const urls: UrlUpdateEvent[] = [];
    renderDesk("?view=roster", (e) => urls.push(e));
    fireEvent.click(screen.getByRole("button", { name: "probe-usual" }));
    expect(unsaved()).toBeNull();
    await waitFor(() => expect(urls[urls.length - 1]?.queryString).toContain("rosterMode=usual"));
    expect(probe().mode).toBe("usual");
  });

  it("phone, dirty: a day arrow inside the week keeps the draft without asking; crossing the week asks", async () => {
    rosterProbe.on = true;
    isPhone.mockReturnValue(true);
    renderDesk("?view=roster&date=2026-11-21");
    fireEvent.click(screen.getByRole("button", { name: "probe-edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Naslednji dan" }));
    await waitFor(() => expect(probe().date).toBe("2026-11-22"));
    expect(unsaved()).toBeNull();
    expect(probe().changed).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Naslednji dan" }));
    expect(await screen.findByRole("dialog", { name: "Neshranjene spremembe" })).toBeInTheDocument();
    expect(probe()).toMatchObject({ date: "2026-11-22", changed: 1 });
  });

  // Flowko U29b (Task 8): the same promises with a real edit through the cell sheet, not the probe's shortcut.
  async function editCellThroughTheSheet(memberId: number, date: string) {
    fireEvent.click(screen.getByTestId(`roster-cell-${memberId}-${date}`));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Prosto" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Uporabi" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }

  it("a real edit through the cell sheet pauses the roster poll; discarding it starts the poll again", async () => {
    renderDesk("?view=roster");
    expect(rosterQuery).toHaveBeenLastCalledWith(
      { weekStart: "2026-11-16" },
      expect.objectContaining({ refetchInterval: 30000, refetchOnWindowFocus: true })
    );
    await editCellThroughTheSheet(ANA, "2026-11-17");
    expect(screen.getByTestId("roster-save-bar")).toBeInTheDocument();
    expect(rosterQuery).toHaveBeenLastCalledWith(
      { weekStart: "2026-11-16" },
      expect.objectContaining({ refetchInterval: false, refetchOnWindowFocus: false })
    );
    fireEvent.click(within(screen.getByTestId("roster-save-bar")).getByRole("button", { name: "Zavrzi" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Želite zavreči spremembe?" })).getByRole("button", {
        name: "Zavrzi",
      })
    );
    await waitFor(() => expect(screen.queryByTestId("roster-save-bar")).toBeNull());
    expect(rosterQuery).toHaveBeenLastCalledWith(
      { weekStart: "2026-11-16" },
      expect.objectContaining({ refetchInterval: 30000 })
    );
  });

  it("phone, a real edit: a day arrow inside the week keeps it without asking, the crossing asks", async () => {
    isPhone.mockReturnValue(true);
    renderDesk("?view=roster&date=2026-11-21");
    await editCellThroughTheSheet(ANA, "2026-11-21");
    fireEvent.click(screen.getByRole("button", { name: "Naslednji dan" }));
    await waitFor(() =>
      expect(
        screen.getByTestId("roster-card-2").querySelector("[data-testid^='roster-cell-2-2026-11-22']")
      ).toBeTruthy()
    );
    expect(unsaved()).toBeNull();
    expect(screen.getByTestId("roster-save-count").textContent).toBe("1 sprememba");
    fireEvent.click(screen.getByRole("button", { name: "Naslednji dan" }));
    expect(await screen.findByRole("dialog", { name: "Neshranjene spremembe" })).toBeInTheDocument();
    expect(screen.getByTestId("roster-save-count").textContent).toBe("1 sprememba");
  });

  it("a load error offers a retry of roster.week", () => {
    const retry = vi.fn();
    rosterQuery.mockReturnValue({ data: undefined, isPending: false, error: new Error("x"), refetch: retry });
    renderDesk("?view=roster");
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(retry).toHaveBeenCalled();
  });
});
