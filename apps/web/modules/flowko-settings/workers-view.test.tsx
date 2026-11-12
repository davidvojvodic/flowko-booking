// Flowko U29c: the owner's „Delavci“ page (W6–W10, P1, P8). Reads workers.list (no suspense, no server initial
// data) and lists every member in the order the server sends: name (+ „(vi)“), role and status badges (LOCKED >
// no login > active), order arrows, „Zakleni“ / „Odkleni“, a LOCKED member's bookings as links to that day. „Zakleni“
// refreshes the list first and opens the dialog with the FRESH count (no dialog when the refresh fails); unlock has
// no dialog; errors per procedure (W10); „Dodaj brez prijave“ at the bottom.
// Flowko U29d (Task 7, U5): the trpc mock gains the invite calls (useUtils().client for invite / resendInvite,
// revokeInvite.useMutation), the list answer gains `invites`, the no-e-mail pin is narrowed to the member rows
// (the invite form and „Povabljeni“ legitimately show addresses; C12 is about members), the uid pin stays on the
// whole view, and the add-form queries are scoped to that form (the invite form also has an „Ime“ field). The
// invite behaviour itself is tested in workers-view.invites.test.tsx.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkersView from "./workers-view";
import {
  ANA,
  BOR,
  CENE,
  DAN,
  DAN_BOOKINGS,
  EVA,
  FRAN,
  localeT,
  WORKERS_VIEW,
  WORKERS_VIEW_INVITES,
} from "./settings.fixture";

const mocks = vi.hoisted(() => ({
  lang: "sl" as "sl" | "en",
  query: vi.fn(),
  refetch: vi.fn(),
  invalidateList: vi.fn(),
  invalidateMembers: vi.fn(),
  invalidateDeskServices: vi.fn(),
  lock: vi.fn(),
  unlock: vi.fn(),
  add: vi.fn(),
  reorder: vi.fn(),
  invite: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT(mocks.lang), i18n: { language: mocks.lang } }),
}));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      // Flowko U29d: the link-minting calls use the vanilla client (no answer kept in the MutationCache, U3).
      client: {
        viewer: {
          flowko: {
            workers: {
              invite: { mutate: (i: unknown) => mocks.invite(i) },
              resendInvite: { mutate: (i: unknown) => mocks.resend(i) },
            },
          },
        },
      },
      viewer: {
        flowko: {
          workers: { list: { invalidate: mocks.invalidateList } },
          business: {
            members: { invalidate: mocks.invalidateMembers },
            services: { invalidate: mocks.invalidateDeskServices },
          },
        },
      },
    }),
    viewer: {
      flowko: {
        workers: {
          list: { useQuery: (...args: unknown[]) => mocks.query(...args) },
          lock: { useMutation: () => ({ mutateAsync: (i: unknown) => mocks.lock(i), isPending: false }) },
          unlock: { useMutation: () => ({ mutateAsync: (i: unknown) => mocks.unlock(i), isPending: false }) },
          addDeskOnly: {
            useMutation: () => ({ mutateAsync: (i: unknown) => mocks.add(i), isPending: false }),
          },
          reorder: {
            useMutation: () => ({ mutateAsync: (i: unknown) => mocks.reorder(i), isPending: false }),
          },
          revokeInvite: {
            useMutation: () => ({ mutateAsync: (i: unknown) => mocks.revoke(i), isPending: false }),
          },
        },
      },
    },
  },
}));

function trpcError(message: string, code = "BAD_REQUEST") {
  return Object.assign(new Error(message), { data: { code } });
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let data: typeof WORKERS_VIEW | undefined;
// react-query's dataUpdatedAt: the focus after a move waits for it to advance (a refetch landed).
let version = 0;
const queryResult = (over: Record<string, unknown> = {}) => ({
  data,
  dataUpdatedAt: version,
  isPending: data === undefined,
  isFetching: false,
  error: null,
  refetch: mocks.refetch,
  ...over,
});

const withRow = (memberId: number, patch: Record<string, unknown>) => ({
  members: WORKERS_VIEW.members.map((m) => (m.memberId === memberId ? { ...m, ...patch } : m)),
  invites: WORKERS_VIEW.invites,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T07:07:00Z"));
  for (const fn of Object.values(mocks)) if (typeof fn === "function") fn.mockReset();
  mocks.lang = "sl";
  data = WORKERS_VIEW;
  version = 0;
  mocks.query.mockImplementation(() => queryResult());
  mocks.refetch.mockResolvedValue(undefined);
  for (const fn of [mocks.invalidateList, mocks.invalidateMembers, mocks.invalidateDeskServices]) {
    fn.mockResolvedValue(undefined);
  }
  mocks.lock.mockResolvedValue({ status: "LOCKED", google: "disconnected", futureCount: 0 });
  mocks.unlock.mockResolvedValue({ status: "ACTIVE" });
  mocks.add.mockResolvedValue({ memberId: 99 });
  mocks.reorder.mockResolvedValue({ status: "saved" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const rows = () => screen.getAllByTestId(/^flowko-worker-row-\d+$/);
const row = (id: number) => screen.getByTestId(`flowko-worker-row-${id}`);
const inRow = (id: number) => within(row(id));
const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};
const dialog = () => screen.getByRole("dialog");
const lockCount = () => mocks.lock.mock.calls.length;

describe("WorkersView: loading", () => {
  it("reads workers.list without suspense or server initial data", () => {
    render(<WorkersView />);
    const [queryInput, options] = mocks.query.mock.calls[0];
    expect(queryInput).toBeUndefined();
    expect(options).toEqual({ refetchOnWindowFocus: false });
  });

  it("shows a skeleton while loading", () => {
    data = undefined;
    render(<WorkersView />);
    expect(screen.getByTestId("flowko-workers-loading")).toBeInTheDocument();
  });

  it("a failed load says so and retries on request", () => {
    data = undefined;
    mocks.query.mockImplementation(() => queryResult({ isPending: false, error: trpcError("forbidden") }));
    render(<WorkersView />);
    expect(screen.getByText("Nekaj je šlo narobe.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});

describe("WorkersView: the list", () => {
  it("is a ul/li list in the order the server sends", () => {
    const { container } = render(<WorkersView />);
    expect(container.querySelector("ul")).not.toBeNull();
    expect(rows().every((r) => r.tagName === "LI")).toBe(true);
    expect(rows().map((r) => r.dataset.testid)).toEqual(
      [ANA, BOR, CENE, DAN, EVA, FRAN].map((id) => `flowko-worker-row-${id}`)
    );
  });

  it("every row wraps (phone-safe)", () => {
    render(<WorkersView />);
    for (const r of rows()) expect(r.className).toContain("flex-wrap");
  });

  it("Ana: Lastnik, (vi), Aktiven, no lock or unlock", () => {
    render(<WorkersView />);
    const r = inRow(ANA);
    expect(r.getByText("Ana")).toBeInTheDocument();
    expect(r.getByText("(vi)")).toBeInTheDocument();
    expect(r.getByText("Lastnik")).toBeInTheDocument();
    expect(r.getByText("Aktiven")).toBeInTheDocument();
    expect(r.queryByRole("button", { name: "Zakleni" })).toBeNull();
    expect(r.queryByRole("button", { name: "Odkleni" })).toBeNull();
  });

  it("Bor (desk-only): Delavec, Brez prijave, Zakleni; no (vi)", () => {
    render(<WorkersView />);
    const r = inRow(BOR);
    expect(r.getByText("Delavec")).toBeInTheDocument();
    expect(r.getByText("Brez prijave")).toBeInTheDocument();
    expect(r.queryByText("(vi)")).toBeNull();
    expect(r.getByRole("button", { name: "Zakleni" })).toBeInTheDocument();
  });

  it("Cene (STAFF without login): Recepcija and Brez prijave", () => {
    render(<WorkersView />);
    const r = inRow(CENE);
    expect(r.getByText("Recepcija")).toBeInTheDocument();
    expect(r.getByText("Brez prijave")).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Zakleni" })).toBeInTheDocument();
  });

  it("Eva (login, ACTIVE): Aktiven and Zakleni; Fran (STAFF with login): Recepcija, Aktiven", () => {
    render(<WorkersView />);
    expect(inRow(EVA).getByText("Aktiven")).toBeInTheDocument();
    expect(inRow(EVA).getByRole("button", { name: "Zakleni" })).toBeInTheDocument();
    expect(inRow(FRAN).getByText("Recepcija")).toBeInTheDocument();
    expect(inRow(FRAN).getByText("Aktiven")).toBeInTheDocument();
  });

  it("Dan (LOCKED): Zaklenjen, Odkleni, no Zakleni, and his bookings as day links", () => {
    render(<WorkersView />);
    const r = inRow(DAN);
    expect(r.getByText("Zaklenjen")).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Odkleni" })).toBeInTheDocument();
    expect(r.queryByRole("button", { name: "Zakleni" })).toBeNull();
    const links = r.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/koledar?view=day&date=2026-11-17");
    expect(links[0]).toHaveTextContent("tor., 17. 11. · 10:00–11:00 · Striženje, Fen · Ana Testna");
    expect(links[1]).toHaveAttribute("href", "/koledar?view=day&date=2027-01-05");
    expect(
      r.getByText("Termin prestavite k drugemu delavcu tako, da ga odpoveste in znova vnesete.")
    ).toBeInTheDocument();
  });

  it("a booking in another year shows the year, one in the current year does not", () => {
    render(<WorkersView />);
    const links = inRow(DAN).getAllByRole("link");
    expect(links[0].textContent).not.toContain("2026");
    expect(links[1]).toHaveTextContent("tor., 5. 1. 2027 · 09:30–10:15 · Barvanje · Jan Novak");
  });

  it("the English date line has the same shape", () => {
    mocks.lang = "en";
    render(<WorkersView />);
    const links = inRow(DAN).getAllByRole("link");
    expect(links[0]).toHaveTextContent(/^Tue, 11\/17 · 10:00–11:00 · Striženje, Fen · Ana Testna$/);
    expect(links[1].textContent).toContain("2027");
  });

  it("a LOCKED worker without bookings says so", () => {
    data = withRow(DAN, { futureCount: 0, futureBookings: [] });
    render(<WorkersView />);
    expect(inRow(DAN).getByText("Ni prihodnjih terminov.")).toBeInTheDocument();
    // UI-1: the text takes its own line under the row (a flex-wrap child without w-full shared the first line).
    expect(screen.getByTestId("flowko-worker-no-bookings").className).toContain("w-full");
    expect(inRow(DAN).queryByRole("link")).toBeNull();
  });

  it("more than 50: the rest is counted (… in še 1 termin)", () => {
    data = withRow(DAN, { futureCount: 51, moreBookings: 1 });
    render(<WorkersView />);
    expect(inRow(DAN).getByText("… in še 1 termin")).toBeInTheDocument();
  });

  it.each([
    [2, "… in še 2 termina"],
    [3, "… in še 3 termini"],
    [5, "… in še 5 terminov"],
  ])("more bookings, %i: plural form", (count, text) => {
    data = withRow(DAN, { moreBookings: count });
    render(<WorkersView />);
    expect(inRow(DAN).getByText(text)).toBeInTheDocument();
  });

  // Flowko U29d (U5): split. C12 (members' accounts never shown): no uid anywhere in the view, no e-mail in a
  // member row, also when invites are open (a desk-only member's invite carries no address).
  it("renders no uid anywhere and no e-mail in a member row", () => {
    const { container } = render(<WorkersView />);
    expect(container.innerHTML).not.toMatch(/uid/i);
    for (const r of rows()) expect(r.innerHTML).not.toMatch(/@/);
  });

  it("with open invites: still no uid anywhere and no e-mail in any member row", () => {
    data = WORKERS_VIEW_INVITES;
    const { container } = render(<WorkersView />);
    expect(container.innerHTML).not.toMatch(/uid/i);
    expect(rows()).toHaveLength(WORKERS_VIEW_INVITES.members.length);
    for (const r of rows()) expect(r.innerHTML).not.toMatch(/@/);
  });
});

describe("WorkersView: lock (W7)", () => {
  it("opens the dialog with the FRESH count, not the cached one", async () => {
    mocks.invalidateList.mockImplementation(async () => {
      data = withRow(EVA, { futureCount: 3 });
    });
    render(<WorkersView />);
    expect(WORKERS_VIEW.members.find((m) => m.memberId === EVA)?.futureCount).toBe(0);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    expect(within(dialog()).getByText("Zakleni: Eva")).toBeInTheDocument();
    expect(
      within(dialog()).getByText("Eva ima 3 prihodnje termine. Ostanejo, dokler jih ne odpoveste.")
    ).toBeInTheDocument();
  });

  it("the refresh runs on workers.list with throwOnError and nothing is locked yet", async () => {
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    expect(mocks.invalidateList).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
    expect(lockCount()).toBe(0);
  });

  it("a failed refresh: no dialog, an error toast, lock not called, the button is back", async () => {
    mocks.invalidateList.mockRejectedValue(new Error("network"));
    render(<WorkersView />);
    const button = inRow(EVA).getByRole("button", { name: "Zakleni" });
    await click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith("Nekaj je šlo narobe.", "error");
    expect(lockCount()).toBe(0);
    expect(inRow(EVA).getByRole("button", { name: "Zakleni" })).toBeEnabled();
  });

  it("a rate-limited refresh shows the rate text", async () => {
    mocks.invalidateList.mockRejectedValue(trpcError("Too many", "TOO_MANY_REQUESTS"));
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    expect(mocks.toast).toHaveBeenCalledWith("Preveč zahtev. Poskusite znova čez trenutek.", "error");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    [1, "Eva ima 1 prihodnji termin. Ostane, dokler ga ne odpoveste."],
    [2, "Eva ima 2 prihodnja termina. Ostaneta, dokler ju ne odpoveste."],
    [3, "Eva ima 3 prihodnje termine. Ostanejo, dokler jih ne odpoveste."],
    [5, "Eva ima 5 prihodnjih terminov. Ostanejo, dokler jih ne odpoveste."],
  ])("the booking text for %i follows the Slovene plural", async (count, text) => {
    data = withRow(EVA, { futureCount: count });
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    expect(within(dialog()).getByText(text)).toBeInTheDocument();
  });

  it("English plural forms", async () => {
    mocks.lang = "en";
    data = withRow(EVA, { futureCount: 1 });
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Lock" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    expect(
      within(dialog()).getByText("Eva has 1 upcoming booking. It stays until you cancel it.")
    ).toBeInTheDocument();
  });

  it("no bookings: the no-bookings text", async () => {
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    expect(within(dialog()).getByText("Eva nima prihodnjih terminov.")).toBeInTheDocument();
  });

  it.each([
    ["Eva (WORKER with login)", EVA, true],
    ["Fran (STAFF with login)", FRAN, true],
    ["Bor (desk-only)", BOR, false],
    ["Cene (STAFF without login)", CENE, false],
  ])("the login line: %s", async (_label, id, shown) => {
    render(<WorkersView />);
    await click(inRow(id).getByRole("button", { name: "Zakleni" }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    const line = "Prijava bo onemogočena, povezava z Googlom pa prekinjena.";
    if (shown) expect(within(dialog()).getByText(line)).toBeInTheDocument();
    else expect(within(dialog()).queryByText(line)).toBeNull();
  });

  it("opens on „Prekliči“", async () => {
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Prekliči" })).toHaveFocus());
  });

  it("„Prekliči“ locks nothing", async () => {
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    await click(within(dialog()).getByRole("button", { name: "Prekliči" }));
    expect(lockCount()).toBe(0);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("„Zakleni“ in the dialog locks, says so, and refreshes after", async () => {
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    const callsBefore = mocks.invalidateList.mock.calls.length;
    await click(within(dialog()).getByRole("button", { name: "Zakleni" }));
    await waitFor(() => expect(mocks.lock).toHaveBeenCalledWith({ memberId: EVA }));
    expect(mocks.toast).toHaveBeenCalledWith("Zaklenjeno: Eva", "success");
    await waitFor(() => expect(mocks.invalidateList.mock.calls.length).toBe(callsBefore + 1));
    expect(mocks.invalidateMembers).toHaveBeenCalled();
    expect(mocks.invalidateDeskServices).toHaveBeenCalled();
  });

  it("google failed: warning toast and „Prekini povezavo z Googlom“ on that row; it locks again; gone after a reload", async () => {
    mocks.lock.mockResolvedValueOnce({ status: "LOCKED", google: "failed", futureCount: 0 });
    const { unmount } = render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    await click(within(dialog()).getByRole("button", { name: "Zakleni" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Eva: dostop je zaklenjen, povezave z Googlom pa ni bilo mogoče prekiniti. Poskusite znova z gumbom „Prekini povezavo z Googlom“.",
        "warning"
      )
    );
    // the refreshed list now has Eva LOCKED
    data = withRow(EVA, { status: "LOCKED" });
    unmount();
    // a fresh mount (reload) has no retry button
    render(<WorkersView />);
    expect(screen.queryByRole("button", { name: "Prekini povezavo z Googlom" })).toBeNull();
  });

  it("the retry button calls lock again and goes away once Google is disconnected", async () => {
    mocks.lock.mockResolvedValueOnce({ status: "LOCKED", google: "failed", futureCount: 0 });
    mocks.invalidateList.mockImplementation(async () => {
      data = withRow(EVA, { status: "LOCKED" });
    });
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    await click(within(dialog()).getByRole("button", { name: "Zakleni" }));
    const retry = await screen.findByRole("button", { name: "Prekini povezavo z Googlom" });
    expect(row(EVA).contains(retry)).toBe(true);
    await click(retry);
    await waitFor(() => expect(lockCount()).toBe(2));
    expect(mocks.lock).toHaveBeenLastCalledWith({ memberId: EVA });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Prekini povezavo z Googlom" })).toBeNull());
  });

  it.each([
    ["forbidden", "BAD_REQUEST", "Za to nimate dovoljenja."],
    ["forbidden", "FORBIDDEN", "Za to nimate dovoljenja."],
    ["owner_cannot_be_locked", "BAD_REQUEST", "Lastnika ni mogoče zakleniti."],
    ["member_not_locked", "BAD_REQUEST", "Ta oseba ni zaklenjena. Seznam je osvežen."],
    ["member_conflict", "BAD_REQUEST", "Hkrati je shranjeval še nekdo. Poskusite znova."],
    ["Too many", "TOO_MANY_REQUESTS", "Preveč zahtev. Poskusite znova čez trenutek."],
    ["boom", "INTERNAL_SERVER_ERROR", "Nekaj je šlo narobe."],
  ])("lock error %s (%s) -> %s", async (message, code, text) => {
    mocks.lock.mockRejectedValue(trpcError(message, code));
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Zakleni" }));
    await click(within(dialog()).getByRole("button", { name: "Zakleni" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
    expect(inRow(EVA).getByRole("button", { name: "Zakleni" })).toBeEnabled();
  });

  it("English error text", async () => {
    mocks.lang = "en";
    mocks.lock.mockRejectedValue(trpcError("member_conflict"));
    render(<WorkersView />);
    await click(inRow(EVA).getByRole("button", { name: "Lock" }));
    await click(within(dialog()).getByRole("button", { name: "Lock" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Someone else was changing this at the same time. Try again.",
        "error"
      )
    );
  });
});

describe("WorkersView: unlock (W9)", () => {
  it("unlocks without a dialog, says so and refreshes", async () => {
    render(<WorkersView />);
    await click(inRow(DAN).getByRole("button", { name: "Odkleni" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(mocks.unlock).toHaveBeenCalledWith({ memberId: DAN }));
    expect(mocks.toast).toHaveBeenCalledWith("Odklenjeno: Dan", "success");
    expect(mocks.invalidateList).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  });

  it("member_not_locked: its text and a refresh", async () => {
    mocks.unlock.mockRejectedValue(trpcError("member_not_locked"));
    render(<WorkersView />);
    await click(inRow(DAN).getByRole("button", { name: "Odkleni" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Ta oseba ni zaklenjena. Seznam je osvežen.", "error")
    );
    expect(mocks.invalidateList).toHaveBeenCalled();
  });

  it.each([
    ["forbidden", "BAD_REQUEST", "Za to nimate dovoljenja."],
    ["member_conflict", "BAD_REQUEST", "Hkrati je shranjeval še nekdo. Poskusite znova."],
    ["Too many", "TOO_MANY_REQUESTS", "Preveč zahtev. Poskusite znova čez trenutek."],
    ["boom", "INTERNAL_SERVER_ERROR", "Nekaj je šlo narobe."],
  ])("unlock error %s (%s) -> %s; the button is back", async (message, code, text) => {
    mocks.unlock.mockRejectedValue(trpcError(message, code));
    render(<WorkersView />);
    await click(inRow(DAN).getByRole("button", { name: "Odkleni" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
    expect(inRow(DAN).getByRole("button", { name: "Odkleni" })).toBeEnabled();
  });

  it("a failed refresh after a saved unlock keeps the toast and shows the refresh notice (P1)", async () => {
    mocks.invalidateList.mockRejectedValueOnce(new Error("network"));
    render(<WorkersView />);
    await click(inRow(DAN).getByRole("button", { name: "Odkleni" }));
    await waitFor(() => expect(screen.getByTestId("flowko-workers-refresh-failed")).toBeInTheDocument());
    expect(mocks.toast).toHaveBeenCalledWith("Odklenjeno: Dan", "success");
    expect(
      screen.getByText("Shranjeno, prikaza pa ni bilo mogoče osvežiti. Kliknite „Osveži“.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("flowko-workers-refresh-failed")).toHaveAttribute("role", "alert");
    // the actions are not blocked
    expect(inRow(EVA).getByRole("button", { name: "Zakleni" })).toBeEnabled();
    await click(screen.getByRole("button", { name: "Osveži" }));
    await waitFor(() => expect(screen.queryByTestId("flowko-workers-refresh-failed")).toBeNull());
  });
});

describe("WorkersView: order (W5, W6, P8)", () => {
  it("the arrows are disabled at the ends", () => {
    render(<WorkersView />);
    expect(inRow(ANA).getByRole("button", { name: "Premakni gor: Ana" })).toBeDisabled();
    expect(inRow(ANA).getByRole("button", { name: "Premakni dol: Ana" })).toBeEnabled();
    expect(inRow(FRAN).getByRole("button", { name: "Premakni dol: Fran" })).toBeDisabled();
    expect(inRow(FRAN).getByRole("button", { name: "Premakni gor: Fran" })).toBeEnabled();
  });

  it("every row, the owner and the locked one included, has arrows", () => {
    render(<WorkersView />);
    for (const [id, name] of [
      [ANA, "Ana"],
      [DAN, "Dan"],
    ] as const) {
      expect(inRow(id).getByRole("button", { name: `Premakni dol: ${name}` })).toBeInTheDocument();
    }
  });

  it("sends the whole new order, then says „Shranjeno“", async () => {
    render(<WorkersView />);
    await click(screen.getByRole("button", { name: "Premakni dol: Bor" }));
    await waitFor(() =>
      expect(mocks.reorder).toHaveBeenCalledWith({ memberIds: [ANA, CENE, BOR, DAN, EVA, FRAN] })
    );
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Shranjeno", "success"));
    expect(mocks.invalidateList).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  });

  it("a failed refresh after a reorder turns every arrow off (a stale order is never sent); „Zakleni“ works; „Osveži“ turns them on", async () => {
    mocks.invalidateList.mockRejectedValueOnce(new Error("network"));
    render(<WorkersView />);
    await click(screen.getByRole("button", { name: "Premakni dol: Bor" }));
    await waitFor(() => expect(screen.getByTestId("flowko-workers-refresh-failed")).toBeInTheDocument());
    expect(mocks.toast).toHaveBeenCalledWith("Shranjeno", "success");
    for (const b of screen.getAllByRole("button", { name: /^Premakni (gor|dol): / }))
      expect(b).toBeDisabled();
    expect(inRow(EVA).getByRole("button", { name: "Zakleni" })).toBeEnabled();
    await click(screen.getByRole("button", { name: "Osveži" }));
    await waitFor(() => expect(screen.queryByTestId("flowko-workers-refresh-failed")).toBeNull());
    expect(screen.getByRole("button", { name: "Premakni dol: Bor" })).toBeEnabled();
  });

  it("moving up sends the swapped list too", async () => {
    render(<WorkersView />);
    await click(screen.getByRole("button", { name: "Premakni gor: Eva" }));
    await waitFor(() =>
      expect(mocks.reorder).toHaveBeenCalledWith({ memberIds: [ANA, BOR, CENE, EVA, DAN, FRAN] })
    );
  });

  it("the arrows are off while the refresh is pending, and a double click sends once", async () => {
    const refresh = deferred();
    mocks.invalidateList.mockReturnValue(refresh.promise);
    render(<WorkersView />);
    const down = screen.getByRole("button", { name: "Premakni dol: Bor" });
    await click(down);
    await click(down);
    await waitFor(() => expect(mocks.reorder).toHaveBeenCalledTimes(1));
    for (const b of screen.getAllByRole("button", { name: /^Premakni (gor|dol): / }))
      expect(b).toBeDisabled();
    await act(async () => {
      refresh.resolve();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Premakni dol: Bor" })).toBeEnabled());
    expect(mocks.reorder).toHaveBeenCalledTimes(1);
  });

  it("focus stays on the same row's arrow after the move", async () => {
    mocks.invalidateList.mockImplementation(async () => {
      version += 1;
      data = {
        invites: [],
        members: [ANA, CENE, BOR, DAN, EVA, FRAN].map(
          (id) => WORKERS_VIEW.members.find((m) => m.memberId === id) as (typeof WORKERS_VIEW.members)[number]
        ),
      };
    });
    render(<WorkersView />);
    await click(screen.getByRole("button", { name: "Premakni dol: Bor" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Premakni dol: Bor" })).toHaveFocus());
  });

  it("focus goes to the other arrow when this one became disabled", async () => {
    mocks.invalidateList.mockImplementation(async () => {
      version += 1;
      data = {
        invites: [],
        members: [ANA, BOR, CENE, DAN, FRAN, EVA].map(
          (id) => WORKERS_VIEW.members.find((m) => m.memberId === id) as (typeof WORKERS_VIEW.members)[number]
        ),
      };
    });
    render(<WorkersView />);
    await click(screen.getByRole("button", { name: "Premakni dol: Eva" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Premakni gor: Eva" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Premakni dol: Eva" })).toBeDisabled();
  });

  it("a failed reorder re-enables the arrows and says why", async () => {
    mocks.reorder.mockRejectedValue(trpcError("member_conflict"));
    render(<WorkersView />);
    await click(screen.getByRole("button", { name: "Premakni dol: Bor" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Hkrati je shranjeval še nekdo. Poskusite znova.", "error")
    );
    expect(screen.getByRole("button", { name: "Premakni dol: Bor" })).toBeEnabled();
    expect(mocks.toast).not.toHaveBeenCalledWith("Shranjeno", "success");
  });

  it("bad_member on a reorder: the order text and a refetch", async () => {
    mocks.reorder.mockRejectedValue(trpcError("bad_member"));
    render(<WorkersView />);
    await click(screen.getByRole("button", { name: "Premakni dol: Bor" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Vrstni red se je medtem spremenil. Seznam je osvežen.",
        "error"
      )
    );
    expect(mocks.refetch).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Premakni dol: Bor" })).toBeEnabled();
  });

  it("a rate-limited reorder shows the rate text", async () => {
    mocks.reorder.mockRejectedValue(trpcError("Too many", "TOO_MANY_REQUESTS"));
    render(<WorkersView />);
    await click(screen.getByRole("button", { name: "Premakni dol: Bor" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Preveč zahtev. Poskusite znova čez trenutek.", "error")
    );
  });
});

describe("WorkersView: add without login (W4, W10)", () => {
  // Flowko U29d (U5): scoped to the add form (the invite form above it also has an „Ime“ field).
  const form = () => within(screen.getByTestId("flowko-worker-add-form"));
  const field = () => form().getByLabelText("Ime") as HTMLInputElement;
  const submit = () => click(form().getByRole("button", { name: "Dodaj" }));
  const type = (value: string) => fireEvent.change(field(), { target: { value } });

  it("has a title, a labelled field limited to 80 characters and an „Dodaj“ button", () => {
    render(<WorkersView />);
    expect(form().getByText("Dodaj brez prijave")).toBeInTheDocument();
    expect(field()).toHaveAttribute("maxlength", "80");
  });

  it("an empty name: inline error, no call", async () => {
    render(<WorkersView />);
    await submit();
    expect(screen.getByText("Vnesite ime (največ 80 znakov).")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("81 characters: bad_name inline, value kept, no call", async () => {
    render(<WorkersView />);
    const long = "a".repeat(81);
    type(long);
    await submit();
    expect(screen.getByText("Vnesite ime (največ 80 znakov).")).toBeInTheDocument();
    expect(field().value).toBe(long);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("bad_member from the server is the same inline text, value kept", async () => {
    mocks.add.mockRejectedValue(trpcError("bad_member"));
    render(<WorkersView />);
    type("Gaj");
    await submit();
    expect(await screen.findByText("Vnesite ime (največ 80 znakov).")).toBeInTheDocument();
    expect(field().value).toBe("Gaj");
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("member_name_taken: inline, aria-invalid, accessible description, value kept", async () => {
    mocks.add.mockRejectedValue(trpcError("member_name_taken"));
    render(<WorkersView />);
    type("Bor");
    await submit();
    const text = "V podjetju je že oseba s tem imenom.";
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription(text);
    expect(field().value).toBe("Bor");
  });

  it("typing again clears the error", async () => {
    mocks.add.mockRejectedValue(trpcError("member_name_taken"));
    render(<WorkersView />);
    type("Bor");
    await submit();
    await screen.findByText("V podjetju je že oseba s tem imenom.");
    type("Bori");
    expect(screen.queryByText("V podjetju je že oseba s tem imenom.")).toBeNull();
    expect(field()).not.toHaveAttribute("aria-invalid");
  });

  it("success: the trimmed name is sent, the toast says it, the field is cleared and the list refreshed", async () => {
    render(<WorkersView />);
    type("  Gaj  ");
    await submit();
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith({ displayName: "Gaj" }));
    expect(mocks.toast).toHaveBeenCalledWith(
      "Dodano: Gaj. Izmene nastavite v Urniku, storitve pa v Storitvah.",
      "success"
    );
    await waitFor(() => expect(field().value).toBe(""));
    expect(mocks.invalidateList).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  });

  it.each([
    ["forbidden", "BAD_REQUEST", "Za to nimate dovoljenja."],
    ["member_conflict", "BAD_REQUEST", "Hkrati je shranjeval še nekdo. Poskusite znova."],
    ["Too many", "TOO_MANY_REQUESTS", "Preveč zahtev. Poskusite znova čez trenutek."],
    ["boom", "INTERNAL_SERVER_ERROR", "Nekaj je šlo narobe."],
  ])("add error %s (%s) -> toast %s, value kept", async (message, code, text) => {
    mocks.add.mockRejectedValue(trpcError(message, code));
    render(<WorkersView />);
    type("Gaj");
    await submit();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
    expect(field().value).toBe("Gaj");
  });

  it("a second click while the add runs sends once", async () => {
    const pending = deferred<{ memberId: number }>();
    mocks.add.mockReturnValue(pending.promise);
    render(<WorkersView />);
    type("Gaj");
    await submit();
    await submit();
    expect(mocks.add).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ memberId: 99 });
    });
  });
});

describe("WorkersView: bookings link data", () => {
  it("lists exactly the bookings the server sent, in that order", () => {
    render(<WorkersView />);
    const hrefs = inRow(DAN)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(DAN_BOOKINGS.map((b) => `/koledar?view=day&date=${b.date}`));
  });
});
