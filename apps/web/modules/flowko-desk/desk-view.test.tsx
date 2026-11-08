// Flowko U28: the desk entry: data, date from the URL (business today by default), „who are you“ chip, and the
// phone layout (one column at a time with a worker select, R15).
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeskView as DeskViewData } from "@calcom/features/flowkoBusiness/desk";

import DeskView from "./desk-view";
import { ANA, BOR, NOW, OLGA, at, deskView, iso, localeT, weekViewOf } from "./desk.fixture";
import { deskTrpc, resetDeskTrpc } from "./desk.testDoubles";

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

function renderDesk(searchParams = "", onUrlUpdate?: (e: UrlUpdateEvent) => void) {
  render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate} hasMemory>
      <TooltipProvider>
        <DeskView />
      </TooltipProvider>
    </NuqsTestingAdapter>
  );
}

const headers = () => screen.getAllByTestId(/^desk-column-header-/).map((h) => h.textContent);
const requestedDates = () => dayQuery.mock.calls.map((c) => (c[0] as { date: string }).date);

describe("DeskView (U28)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    isPhone.mockReturnValue(false);
    me.mockReturnValue({ status: "member", me: { businessId: 9, memberId: OLGA, role: "OWNER" } });
    answer(deskView());
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("on a tablet shows every column, today by default, and asks who is at the desk", () => {
    renderDesk();
    expect(requestedDates()).toContain("2026-11-16");
    expect(headers()).toEqual(["Olga", "Ana", "Bor", "Cene", "Dan (zaklenjen)"]);
    expect(screen.getByRole("button", { name: "Kdo ste?" })).toBeInTheDocument();
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
    me.mockReturnValue({ status: "member", me: { businessId: 9, memberId: ANA, role: "WORKER" } });
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
    me.mockReturnValue({ status: "member", me: { businessId: 9, memberId: 5, role: "STAFF" } });
    const view = deskView();
    view.days[0].columns = view.days[0].columns.map((c) => ({ ...c, isMe: false }));
    answer(view);
    renderDesk();
    expect(headers()).toEqual(["Olga"]);
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
    me.mockReturnValue({ status: "member", me: { businessId: 9, memberId: OLGA, role: "OWNER" } });
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
    me.mockReturnValue({ status: "member", me: { businessId: 9, memberId: ANA, role: "WORKER" } });
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
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
    expect(screen.queryByRole("dialog", { name: "Barvanje" })).toBeNull();
    expect(banner()?.textContent).toContain("Izberite nov čas za Marija Novak");
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

  it("move mode stays on the next day and a tap there moves to that day", async () => {
    renderDesk();
    openBarvanje();
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
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

  it("„Prekliči“ and Esc leave move mode; a booking tap opens nothing while moving", () => {
    renderDesk();
    openBarvanje();
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
    fireEvent.click(
      screen.getByTestId("desk-booking-102").querySelector('[data-kind="busy"]') as HTMLElement
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Prekliči" }));
    expect(banner()).toBeNull();
    openBarvanje();
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
    fireEvent.click(column(ANA), { clientY: yOf("15:00") });
    const dialog = await screen.findByRole("dialog", { name: "Termin ni v skladu s pravili" });
    expect(refetch).toHaveBeenCalled();
    expect(dialog.textContent).toContain("Barvanje: zunaj izmene delavca.");
    fireEvent.click(screen.getByRole("button", { name: "Vseeno shrani" }));
    await waitFor(() =>
      expect(deskTrpc.move).toHaveBeenLastCalledWith(expect.objectContaining({ confirmOverride: true }))
    );
    await waitFor(() => expect(banner()).toBeNull());
  });

  it("„Prestavi k drugemu delavcu“ opens the booking sheet for the same customer", () => {
    renderDesk();
    openBarvanje();
    fireEvent.click(screen.getByRole("button", { name: "Prestavi k drugemu delavcu" }));
    expect(screen.getByRole("dialog", { name: "Prestavi k drugemu delavcu" })).toBeInTheDocument();
    expect((screen.getByLabelText("Ime in priimek") as HTMLInputElement).value).toBe("Marija Novak");
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
    me.mockReturnValue({ status: "member", me: { businessId: 9, memberId: OLGA, role: "OWNER" } });
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
    me.mockReturnValue({ status: "member", me: { businessId: 9, memberId: 5, role: "STAFF" } });
    renderDesk("?view=week");
    expect(Array.from(new Set(weekMembers()))).toEqual([OLGA]);
    cleanup();
    weekQuery.mockClear();
    me.mockReturnValue({ status: "member", me: { businessId: 9, memberId: ANA, role: "WORKER" } });
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
    me.mockReturnValue({ status: "member", me: { businessId: 9, memberId: ANA, role: "WORKER" } });
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
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
    expect(banner()?.textContent).toContain("Izberite nov čas za Marija Novak");
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
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Prestavi" }));
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
    expect(screen.getByText("Ni še delavcev.")).toBeInTheDocument();
  });
});
