// Flowko U28: the desk entry: data, date from the URL (business today by default), „who are you“ chip, and the
// phone layout (one column at a time with a worker select, R15).
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeskView as DeskViewData } from "@calcom/features/flowkoBusiness/desk";

import DeskView from "./desk-view";
import { ANA, BOR, NOW, OLGA, deskView, localeT, members } from "./desk.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));

const isPhone = vi.fn(() => false);
vi.mock("@calcom/lib/hooks/useMediaQuery", () => ({ default: () => isPhone() }));

const me = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoBusiness", () => ({ useFlowkoBusiness: () => me() }));

const dayQuery = vi.fn();
const refetch = vi.fn();
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      viewer: { flowko: { bookings: { day: { invalidate: vi.fn() }, week: { invalidate: vi.fn() } } } },
    }),
    viewer: {
      flowko: {
        bookings: { day: { useQuery: (...args: unknown[]) => dayQuery(...args) } },
        business: { members: { useQuery: () => ({ data: members }) } },
      },
    },
  },
}));

function answer(view: DeskViewData | undefined, extra: Record<string, unknown> = {}) {
  dayQuery.mockReturnValue({ data: view, dataUpdatedAt: NOW.getTime(), refetch, isPending: !view, error: null, ...extra });
}

function renderDesk(searchParams = "") {
  render(
    <NuqsTestingAdapter searchParams={searchParams} hasMemory>
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
