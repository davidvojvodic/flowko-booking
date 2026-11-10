// Flowko U29b (Task 8, S12–S16, D6–D11, Review Focus 4 and 6): editing in Urnik: a tappable cell opens the cell sheet,
// „Uporabi“ writes only the draft (highlight, no web storage, no mutation), the save bar, the save flow (saved after
// the refresh, needs_confirm → warnings → resend, roster_changed → discard + refetch + alert, other codes → toasts),
// „Običajni teden“ (planned-weeks note) and „Kopiraj prejšnji teden“. Flowko U29c (P1, P7, P8): a save or copy
// started before A → Dan → A leaves the new draft alone, „Shranjeno“ after every save, and the refresh-failed notice
// with „Poskusi znova“ that holds „Shrani“ back.
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";

import { RosterView } from "./RosterView";
import {
  ANA,
  BOR,
  CENE,
  DATE,
  OLGA,
  businessMe,
  localeT,
  rosterWeek,
  usualVersionOf,
  weekVersionOf,
} from "./desk.fixture";
import { deskTrpc, resetDeskTrpc, trpcError } from "./desk.testDoubles";
import { type RosterDraft, useRosterDraft } from "./useRosterDraft";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigation.push }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));
const me = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoBusiness", () => ({ useFlowkoBusiness: () => me() }));
vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
const toast = vi.hoisted(() => vi.fn());
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => toast(...args) }));

type Props = Parameters<typeof RosterView>[0];
const captured: { draft: RosterDraft | null } = { draft: null };
const spies = { onOpenDay: vi.fn(), onModeChange: vi.fn(), guard: vi.fn((action: () => void) => action()) };

function Harness(props: Partial<Props>) {
  const mode = props.mode ?? "week";
  const view = "view" in props ? props.view : rosterWeek();
  const draft = useRosterDraft(view?.weekStart ?? DATE, mode);
  captured.draft = draft;
  return (
    <TooltipProvider>
      <RosterView
        view={view}
        isPending={false}
        mode={mode}
        date={DATE}
        today={DATE}
        isPhone={false}
        draft={draft}
        guard={spies.guard}
        onOpenDay={spies.onOpenDay}
        onModeChange={spies.onModeChange}
        {...props}
      />
    </TooltipProvider>
  );
}
const renderRoster = (props: Partial<Props> = {}) => render(<Harness {...props} />);

const TUE = "2026-11-17";
const WED = "2026-11-18";
const cell = (memberId: number, key: string) => screen.getByTestId(`roster-cell-${memberId}-${key}`);
const sheet = () => screen.findByRole("dialog");
const bar = () => screen.getByTestId("roster-save-bar");
const saveButton = () => within(bar()).getByRole("button", { name: "Shrani" }) as HTMLButtonElement;

/** Taps a cell, picks a choice in the sheet, „Uporabi“. */
async function applyChoice(memberId: number, key: string, choice: "Prosto" | "Običajno") {
  fireEvent.click(cell(memberId, key));
  const dialog = await sheet();
  fireEvent.click(within(dialog).getByRole("button", { name: choice }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Uporabi" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  resetDeskTrpc();
  toast.mockReset();
  spies.guard.mockImplementation((action: () => void) => action());
  me.mockReturnValue(businessMe(OLGA, "OWNER", false));
  deskTrpc.saveWeek.mockResolvedValue({ status: "saved" });
  deskTrpc.saveUsualWeeks.mockResolvedValue({ status: "saved" });
  captured.draft = null;
});
afterEach(cleanup);

describe("RosterView editing: the cell sheet (S12, S13)", () => {
  it("a tappable cell's accessible name carries the worker and the day (Task 7 carry)", () => {
    renderRoster();
    const button = screen.getByRole("button", { name: /^Ana, .*17\. 11\./ });
    expect(button).toBe(cell(ANA, TUE));
    expect(button.getAttribute("aria-label")).toContain("08:00–16:00");
    expect(screen.getByRole("button", { name: /^Bor, .*18\. 11\..*Prosto/ })).toBe(cell(BOR, WED));
  });

  it("a cell that is not editable is no button", () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", false));
    renderRoster({ view: rosterWeek({ canEditUsualWeek: false, editableMemberIds: [ANA] }) });
    expect(cell(BOR, TUE).tagName).toBe("DIV");
    expect(cell(ANA, TUE).tagName).toBe("BUTTON");
  });

  it("opens with the worker and the day as title, the usual week chosen and the opening hours as a hint", async () => {
    renderRoster();
    fireEvent.click(cell(ANA, TUE));
    const dialog = await sheet();
    expect(within(dialog).getByText(/^Ana · .*17\. 11\./)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Običajno" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(within(dialog).getByTestId("roster-sheet-hint").textContent).toBe("Odprto 08:00–19:00");
  });

  it("„Uporabi“ writes only the draft: highlight, no mutation, no web storage", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBe("true");
    expect(cell(ANA, TUE).className).toContain("ring-brand-default");
    expect(cell(ANA, TUE).textContent).toBe("Prosto");
    expect(captured.draft?.changedCount).toBe(1);
    expect(deskTrpc.saveWeek).not.toHaveBeenCalled();
    expect(deskTrpc.saveUsualWeeks).not.toHaveBeenCalled();
    expect(deskTrpc.addAbsence).not.toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it("setting a cell back to the stored value drops the highlight and the bar", async () => {
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    expect(bar()).toBeTruthy();
    await applyChoice(ANA, TUE, "Običajno");
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBeNull();
    expect(cell(ANA, TUE).textContent).toBe("08:00–16:00");
    expect(screen.queryByTestId("roster-save-bar")).toBeNull();
    expect(captured.draft?.dirty).toBe(false);
  });

  it("reopening a changed cell starts from the draft value", async () => {
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(cell(ANA, TUE));
    const dialog = await sheet();
    expect(within(dialog).getByRole("button", { name: "Prosto" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("an edit on the phone's day list works the same", async () => {
    renderRoster({ isPhone: true, date: TUE });
    await applyChoice(ANA, TUE, "Prosto");
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBe("true");
    expect(bar()).toBeTruthy();
  });

  it("the grid takes the dirty max height while there are edits (S10)", async () => {
    renderRoster();
    expect(screen.getByTestId("roster-grid").className).toContain("max-h-[calc(100dvh-15rem)]");
    await applyChoice(ANA, TUE, "Prosto");
    expect(screen.getByTestId("roster-grid").className).toContain("max-h-[calc(100dvh-17rem)]");
  });
});

describe("RosterView editing: the save bar (S13, Review Focus 6)", () => {
  it("shows the count as a plural, and only while there are edits", async () => {
    renderRoster();
    expect(screen.queryByTestId("roster-save-bar")).toBeNull();
    await applyChoice(ANA, TUE, "Prosto");
    expect(screen.getByTestId("roster-save-count").textContent).toBe("1 sprememba");
    await applyChoice(BOR, "2026-11-20", "Prosto");
    expect(screen.getByTestId("roster-save-count").textContent).toBe("2 spremembi");
    await applyChoice(OLGA, TUE, "Prosto");
    expect(screen.getByTestId("roster-save-count").textContent).toBe("3 spremembe");
  });

  it("sits above the phone's bottom navigation, outside the grid, and the content has room under it", async () => {
    renderRoster({ isPhone: true, date: TUE });
    await applyChoice(ANA, TUE, "Prosto");
    const el = bar();
    expect(el.className).toContain("bottom-20");
    expect(el.className).toContain("z-40");
    expect(el.closest('[data-testid="roster-day-list"]')).toBeNull();
    expect(el.closest('[data-testid="desk-grid-scroll"]')).toBeNull();
    expect(screen.getByTestId("roster-view").className).toContain("pb-28");
  });

  it("„Zavrzi“ asks, then drops the whole draft", async () => {
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(within(bar()).getByRole("button", { name: "Zavrzi" }));
    const dialog = screen.getByRole("dialog", { name: "Želite zavreči spremembe?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Prekliči" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Zavrzi" }));
    await waitFor(() => expect(screen.queryByTestId("roster-save-bar")).toBeNull());
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBeNull();
    expect(captured.draft?.dirty).toBe(false);
  });
});

describe("RosterView editing: the save flow (S14, S16)", () => {
  it("sends the full row with the snapshot's version, then refreshes before the draft goes", async () => {
    const refresh = deferred();
    deskTrpc.invalidateRosterWeek.mockReturnValue(refresh.promise);
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    await waitFor(() => expect(deskTrpc.saveWeek).toHaveBeenCalledTimes(1));
    expect(deskTrpc.saveWeek).toHaveBeenCalledWith({
      weekStart: DATE,
      rows: [
        {
          memberId: ANA,
          version: weekVersionOf(ANA),
          days: { mon: null, tue: [], wed: null, thu: null, fri: null, sat: null, sun: null },
        },
      ],
      confirm: false,
    });
    await waitFor(() => expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalled());
    // The refresh has not finished: the edit is still on screen and „Shrani“ is still busy.
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBe("true");
    expect(cell(ANA, TUE).textContent).toBe("Prosto");
    expect(saveButton().disabled).toBe(true);
    // No new edit can slip in while the save runs: the cells are not tappable.
    expect(cell(ANA, TUE).tagName).toBe("DIV");
    await act(async () => {
      refresh.resolve();
    });
    await waitFor(() => expect(screen.queryByTestId("roster-save-bar")).toBeNull());
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBeNull();
    expect(captured.draft?.dirty).toBe(false);
    expect(deskTrpc.invalidateDay).toHaveBeenCalled();
  });

  it("needs_confirm opens one dialog with the worker, the date and „1 termin“; „Vseeno shrani“ resends with confirm", async () => {
    deskTrpc.saveWeek.mockResolvedValueOnce({
      status: "needs_confirm",
      warnings: [{ memberId: ANA, outsideOpening: [TUE], bookingsNewlyOutside: 1 }],
    });
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole("dialog", { name: "Opozorilo pred shranjevanjem" });
    const group = within(dialog).getByTestId(`roster-warning-group-${ANA}`);
    expect(group.textContent).toContain("Ana");
    expect(group.textContent).toContain("17. 11.");
    expect(group.textContent).toContain("1 termin");
    expect(deskTrpc.invalidateRosterWeek).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Vseeno shrani" }));
    await waitFor(() => expect(deskTrpc.saveWeek).toHaveBeenCalledTimes(2));
    expect(deskTrpc.saveWeek.mock.calls[1][0]).toMatchObject({ confirm: true });
    expect(deskTrpc.saveWeek.mock.calls[1][0].rows).toEqual(deskTrpc.saveWeek.mock.calls[0][0].rows);
    await waitFor(() => expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("roster-save-bar")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("„Prekliči“ in the warnings keeps the draft and sends nothing more", async () => {
    deskTrpc.saveWeek.mockResolvedValueOnce({
      status: "needs_confirm",
      warnings: [{ memberId: ANA, outsideOpening: [], bookingsNewlyOutside: 2 }],
    });
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole("dialog", { name: "Opozorilo pred shranjevanjem" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Prekliči" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deskTrpc.saveWeek).toHaveBeenCalledTimes(1);
    expect(captured.draft?.changedCount).toBe(1);
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBe("true");
    expect(saveButton().disabled).toBe(false);
  });

  it("warnings for Ana and Bor are one dialog with two worker groups in row order", async () => {
    deskTrpc.saveWeek.mockResolvedValueOnce({
      status: "needs_confirm",
      warnings: [
        { memberId: BOR, outsideOpening: [], bookingsNewlyOutside: 1 },
        { memberId: ANA, outsideOpening: [TUE], bookingsNewlyOutside: 0 },
      ],
    });
    renderRoster();
    await applyChoice(BOR, "2026-11-20", "Prosto");
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole("dialog", { name: "Opozorilo pred shranjevanjem" });
    const groups = within(dialog).getAllByTestId(/^roster-warning-group-/);
    expect(groups.map((g) => g.getAttribute("data-testid"))).toEqual([
      `roster-warning-group-${ANA}`,
      `roster-warning-group-${BOR}`,
    ]);
    // The rows go out in the snapshot's order too.
    expect(deskTrpc.saveWeek.mock.calls[0][0].rows.map((r: { memberId: number }) => r.memberId)).toEqual([
      ANA,
      BOR,
    ]);
  });

  it("roster_changed: nothing is kept, the draft is dropped, the week is refetched and an alert says so", async () => {
    deskTrpc.saveWeek.mockRejectedValueOnce(trpcError("roster_changed"));
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Urnik je medtem spremenil nekdo drug. Prikazan je trenutni urnik.");
    expect(captured.draft?.dirty).toBe(false);
    expect(screen.queryByTestId("roster-save-bar")).toBeNull();
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBeNull();
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("roster_changed on the confirm resend does the same and closes the dialog", async () => {
    deskTrpc.saveWeek
      .mockResolvedValueOnce({
        status: "needs_confirm",
        warnings: [{ memberId: ANA, outsideOpening: [TUE], bookingsNewlyOutside: 0 }],
      })
      .mockRejectedValueOnce(trpcError("roster_changed"));
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole("dialog", { name: "Opozorilo pred shranjevanjem" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Vseeno shrani" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await screen.findByRole("alert")).textContent).toContain("Urnik je medtem spremenil");
    expect(captured.draft?.dirty).toBe(false);
  });

  it("roster_conflict is a toast and the draft stays (retryable)", async () => {
    deskTrpc.saveWeek.mockRejectedValueOnce(trpcError("roster_conflict"));
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Hkrati je shranjeval še nekdo. Poskusite znova.", "error")
    );
    expect(captured.draft?.changedCount).toBe(1);
    expect(saveButton().disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(deskTrpc.invalidateRosterWeek).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", "FORBIDDEN", "flowko_roster_error_forbidden"],
    ["bad_roster", "BAD_REQUEST", "flowko_roster_error_bad_roster"],
    ["week_out_of_range", "BAD_REQUEST", "flowko_roster_error_week_out_of_range"],
    ["bad_absence", "BAD_REQUEST", "flowko_roster_error_bad_absence"],
    ["not_a_holiday", "BAD_REQUEST", "flowko_roster_error_not_a_holiday"],
    ["Too many requests", "TOO_MANY_REQUESTS", "flowko_settings_error_TOO_MANY_REQUESTS"],
    ["Internal", "INTERNAL_SERVER_ERROR", "something_went_wrong"],
  ])("a %s answer is a toast with its text and keeps the draft", async (message, trpcCode, key) => {
    deskTrpc.saveWeek.mockRejectedValueOnce(trpcError(message, trpcCode));
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(localeT("sl")(key), "error"));
    expect(localeT("sl")(key)).not.toBe(key);
    expect(captured.draft?.changedCount).toBe(1);
  });

  it("the Dan view of the draft never sends a row for an unchanged worker", async () => {
    renderRoster();
    await applyChoice(CENE, TUE, "Prosto");
    fireEvent.click(saveButton());
    await waitFor(() => expect(deskTrpc.saveWeek).toHaveBeenCalled());
    expect(deskTrpc.saveWeek.mock.calls[0][0].rows).toHaveLength(1);
    expect(deskTrpc.saveWeek.mock.calls[0][0].rows[0].memberId).toBe(CENE);
  });
});

describe("RosterView editing: a save or copy of an older week (Task 8 fix 1, D7)", () => {
  const NEXT = "2026-11-23";
  const NEXT_TUE = "2026-11-24";

  const nextView = () => rosterWeek({ weekStart: NEXT, today: DATE });

  /** Harness whose week the test changes with `rerender`, as DeskView does after „Zavrzi in nadaljuj“. */
  function renderSwitching() {
    const utils = render(<Harness view={rosterWeek()} date={DATE} />);
    const toNextWeek = () => utils.rerender(<Harness view={nextView()} date={NEXT} />);
    return { toNextWeek };
  }

  it("a save still running when the week changes does not wipe the new week's draft", async () => {
    const save = deferred<{ status: "saved" }>();
    deskTrpc.saveWeek.mockReturnValueOnce(save.promise);
    const { toNextWeek } = renderSwitching();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    await waitFor(() => expect(deskTrpc.saveWeek).toHaveBeenCalledTimes(1));
    toNextWeek();
    expect(captured.draft?.dirty).toBe(false);
    // Cells are not tappable while the save runs, so the edit goes straight into the draft (the hook's promise).
    act(() => captured.draft?.set(nextView(), ANA, NEXT_TUE, []));
    expect(captured.draft?.changedCount).toBe(1);
    await act(async () => {
      save.resolve({ status: "saved" });
    });
    await waitFor(() => expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalled());
    expect(captured.draft?.changedCount).toBe(1);
    expect(cell(ANA, NEXT_TUE).getAttribute("data-changed")).toBe("true");
    expect(screen.getByTestId("roster-save-count").textContent).toBe("1 sprememba");
  });

  it("a needs_confirm of an older week's save opens no dialog over the new week", async () => {
    const save = deferred<unknown>();
    deskTrpc.saveWeek.mockReturnValueOnce(save.promise);
    const { toNextWeek } = renderSwitching();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    await waitFor(() => expect(deskTrpc.saveWeek).toHaveBeenCalledTimes(1));
    toNextWeek();
    act(() => captured.draft?.set(nextView(), ANA, NEXT_TUE, []));
    await act(async () => {
      save.resolve({
        status: "needs_confirm",
        warnings: [{ memberId: ANA, outsideOpening: [TUE], bookingsNewlyOutside: 1 }],
      });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(captured.draft?.changedCount).toBe(1);
  });

  it("while a copy is fetching, cells are not tappable and „Shrani“ waits", async () => {
    const fetching = deferred<RosterWeekView>();
    deskTrpc.fetchRosterWeek.mockReturnValueOnce(fetching.promise);
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(screen.getByRole("button", { name: "Kopiraj prejšnji teden" }));
    await waitFor(() => expect(deskTrpc.fetchRosterWeek).toHaveBeenCalled());
    expect(cell(ANA, TUE).tagName).toBe("DIV");
    expect(saveButton().disabled).toBe(true);
    await act(async () => {
      fetching.resolve(rosterWeek({ weekStart: "2026-11-09" }));
    });
    await waitFor(() => expect(cell(ANA, TUE).tagName).toBe("BUTTON"));
    expect(saveButton().disabled).toBe(false);
  });

  it("a copy still fetching when the week changes fills nothing in the new week", async () => {
    const fetching = deferred<RosterWeekView>();
    deskTrpc.fetchRosterWeek.mockReturnValueOnce(fetching.promise);
    const { toNextWeek } = renderSwitching();
    fireEvent.click(screen.getByRole("button", { name: "Kopiraj prejšnji teden" }));
    await waitFor(() => expect(deskTrpc.fetchRosterWeek).toHaveBeenCalledWith({ weekStart: "2026-11-09" }));
    toNextWeek();
    const previous = rosterWeek({ weekStart: "2026-11-09" });
    await act(async () => {
      fetching.resolve({
        ...previous,
        members: previous.members.map((m) =>
          m.memberId === ANA
            ? { ...m, days: m.days.map((d) => ({ ...d, source: "planned" as const, entries: [] })) }
            : m
        ),
      });
    });
    expect(captured.draft?.dirty).toBe(false);
    expect(screen.queryByTestId("roster-save-bar")).toBeNull();
    expect(cell(ANA, NEXT_TUE).getAttribute("data-changed")).toBeNull();
  });
});

describe("RosterView editing: „Običajni teden“ (S4, S14)", () => {
  const usualCell = (memberId: number, weekday: string) => cell(memberId, weekday);

  it("a usual-week cell sheet has no „Odsotnost“ and no „Običajno“; saving without warnings shows the note and no dialog", async () => {
    renderRoster({ mode: "usual" });
    fireEvent.click(usualCell(ANA, "sat"));
    const dialog = await sheet();
    expect(within(dialog).queryByText("Odsotnost")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Običajno" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Prosto" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Uporabi" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(usualCell(ANA, "sat").getAttribute("data-changed")).toBe("true");
    expect(within(bar()).getByTestId("roster-save-note").textContent).toBe(
      "Tedni s posebnim urnikom ostanejo nespremenjeni."
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(deskTrpc.saveUsualWeeks).toHaveBeenCalledTimes(1));
    expect(deskTrpc.saveUsualWeeks).toHaveBeenCalledWith({
      rows: [
        {
          memberId: ANA,
          version: usualVersionOf(ANA),
          usualWeek: {
            mon: [{ from: "08:00", to: "16:00" }],
            tue: [{ from: "08:00", to: "16:00" }],
            wed: [{ from: "08:00", to: "16:00" }],
            thu: [{ from: "08:00", to: "16:00" }],
            fri: [{ from: "08:00", to: "16:00" }],
            sat: [],
            sun: [],
          },
        },
      ],
      confirm: false,
    });
    expect(deskTrpc.saveWeek).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("roster-save-bar")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the warnings dialog repeats the planned-weeks note and a confirm resends to saveUsualWeeks", async () => {
    deskTrpc.saveUsualWeeks.mockResolvedValueOnce({
      status: "needs_confirm",
      warnings: [{ memberId: ANA, outsideOpening: ["sun"], bookingsNewlyOutside: 3 }],
    });
    renderRoster({ mode: "usual" });
    fireEvent.click(usualCell(ANA, "sun"));
    const dialog = await sheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "Izmene" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Uporabi" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(saveButton());
    const warnings = await screen.findByRole("dialog", { name: "Opozorilo pred shranjevanjem" });
    expect(within(warnings).getByTestId("roster-warning-usual-note")).toBeTruthy();
    expect(within(warnings).getByTestId(`roster-warning-group-${ANA}`).textContent).toContain("nedelja");
    fireEvent.click(within(warnings).getByRole("button", { name: "Vseeno shrani" }));
    await waitFor(() => expect(deskTrpc.saveUsualWeeks).toHaveBeenCalledTimes(2));
    expect(deskTrpc.saveUsualWeeks.mock.calls[1][0]).toMatchObject({ confirm: true });
  });

  it("a usual week emptied on every day is sent as null (one form for „no usual week“)", async () => {
    renderRoster({ mode: "usual" });
    for (const day of ["mon", "tue", "wed", "thu", "fri"]) {
      fireEvent.click(usualCell(OLGA, day));
      const dialog = await sheet();
      fireEvent.click(within(dialog).getByRole("button", { name: "Prosto" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Uporabi" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    fireEvent.click(saveButton());
    await waitFor(() => expect(deskTrpc.saveUsualWeeks).toHaveBeenCalled());
    expect(deskTrpc.saveUsualWeeks.mock.calls[0][0].rows[0]).toMatchObject({
      memberId: OLGA,
      usualWeek: null,
    });
  });
});

describe("RosterView editing: „Kopiraj prejšnji teden“ (S15, D11)", () => {
  const PREV = "2026-11-09";
  /** The week before: Ana worked a planned 10–14 on Tuesday the 10th, everything else follows the usual week. */
  function previousWeek(): RosterWeekView {
    const base = rosterWeek({ weekStart: PREV });
    return {
      ...base,
      members: base.members.map((m) =>
        m.memberId === ANA
          ? {
              ...m,
              days: m.days.map((d) =>
                d.date === "2026-11-10"
                  ? { ...d, source: "planned" as const, entries: [{ from: "10:00", to: "14:00" }] }
                  : d
              ),
            }
          : m
      ),
    };
  }
  const copyButton = () => screen.getByRole("button", { name: "Kopiraj prejšnji teden" });

  beforeEach(() => {
    deskTrpc.fetchRosterWeek.mockResolvedValue(previousWeek());
  });

  it("fetches the week before and fills the draft for every editable row; nothing is saved", async () => {
    renderRoster();
    fireEvent.click(copyButton());
    await waitFor(() => expect(deskTrpc.fetchRosterWeek).toHaveBeenCalledWith({ weekStart: PREV }));
    await waitFor(() => expect(captured.draft?.dirty).toBe(true));
    // Ana's Tuesday gets the planned 10–14; Bor's two planned days go back to the usual week.
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBe("true");
    expect(cell(ANA, TUE).textContent).toBe("10:00–14:00");
    expect(cell(BOR, WED).getAttribute("data-changed")).toBe("true");
    expect(cell(BOR, "2026-11-19").getAttribute("data-changed")).toBe("true");
    expect(captured.draft?.changedCount).toBe(3);
    expect(screen.getByTestId("roster-save-count").textContent).toBe("3 spremembe");
    expect(deskTrpc.saveWeek).not.toHaveBeenCalled();
    // Ana's absence on Friday is never copied or removed.
    expect(cell(ANA, "2026-11-20").textContent).toBe("Odsotnost");
    expect(cell(ANA, "2026-11-20").getAttribute("data-changed")).toBeNull();
  });

  it("a worker copies only her own row", async () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", false));
    renderRoster({ view: rosterWeek({ canEditUsualWeek: false, editableMemberIds: [ANA] }) });
    fireEvent.click(copyButton());
    await waitFor(() => expect(captured.draft?.dirty).toBe(true));
    expect(captured.draft?.changedCount).toBe(1);
    expect(cell(BOR, WED).getAttribute("data-changed")).toBeNull();
  });

  it("is not offered in the usual week, to STAFF, in a past week or beyond the window", () => {
    renderRoster({ mode: "usual" });
    expect(screen.queryByRole("button", { name: "Kopiraj prejšnji teden" })).toBeNull();
    cleanup();
    me.mockReturnValue(businessMe(5, "STAFF", false));
    renderRoster({ view: rosterWeek({ canEditUsualWeek: false, editableMemberIds: [] }) });
    expect(screen.queryByRole("button", { name: "Kopiraj prejšnji teden" })).toBeNull();
    cleanup();
    me.mockReturnValue(businessMe(OLGA, "OWNER", false));
    renderRoster({ view: rosterWeek({ weekStart: PREV }), date: PREV });
    expect(screen.queryByRole("button", { name: "Kopiraj prejšnji teden" })).toBeNull();
    cleanup();
    renderRoster({
      view: rosterWeek({ weekStart: "2027-11-29", lastWritableWeekStart: "2027-11-22" }),
      date: "2027-11-29",
    });
    expect(screen.queryByRole("button", { name: "Kopiraj prejšnji teden" })).toBeNull();
  });

  it("a failed read is a toast and leaves the draft alone", async () => {
    deskTrpc.fetchRosterWeek.mockRejectedValue(trpcError("week_out_of_range"));
    renderRoster();
    fireEvent.click(copyButton());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(localeT("sl")("flowko_roster_error_week_out_of_range"), "error")
    );
    expect(captured.draft?.dirty).toBe(false);
  });
});

describe("RosterView editing: absences from a cell (Task 9, S7, D12)", () => {
  const FRI = "2026-11-20";
  const sheetDialog = () => screen.getByRole("dialog", { name: /^Ana · / });

  it("week mode: add 17.–18. 11. → addAbsence with confirm false, the roster is refreshed, the sheet closes", async () => {
    deskTrpc.addAbsence.mockResolvedValueOnce({ status: "saved", absenceId: 90 });
    renderRoster();
    fireEvent.click(cell(ANA, TUE));
    const dialog = await sheet();
    fireEvent.change(within(dialog).getByLabelText("Zadnji dan odsotnosti"), {
      target: { value: WED },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj odsotnost" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deskTrpc.addAbsence).toHaveBeenCalledWith({
      memberId: ANA,
      startDate: TUE,
      endDate: WED,
      confirm: false,
    });
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(1);
    expect(captured.draft?.dirty).toBe(false);
  });

  it("needs_confirm 2 → „2 termina v tem času ostaneta v koledarju“ → „Vseeno dodaj“ resends with confirm true", async () => {
    deskTrpc.addAbsence
      .mockResolvedValueOnce({ status: "needs_confirm", bookings: 2 })
      .mockResolvedValueOnce({ status: "saved", absenceId: 91 });
    renderRoster();
    fireEvent.click(cell(ANA, TUE));
    fireEvent.click(within(await sheet()).getByRole("button", { name: "Dodaj odsotnost" }));
    const confirm = await screen.findByText("2 termina v tem času ostaneta v koledarju");
    expect(deskTrpc.invalidateRosterWeek).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm.closest('[role="dialog"]') as HTMLElement).getByRole("button", {
        name: "Vseeno dodaj",
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deskTrpc.addAbsence).toHaveBeenLastCalledWith({
      memberId: ANA,
      startDate: TUE,
      endDate: TUE,
      confirm: true,
    });
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(1);
  });

  it("a cell that shows an absence lists its stored range and removes it whole", async () => {
    deskTrpc.removeAbsence.mockResolvedValueOnce({ ok: true });
    renderRoster({
      view: rosterWeek({
        members: rosterWeek().members.map((m) =>
          m.memberId === ANA
            ? {
                ...m,
                absences: [{ id: 71, startDate: FRI, endDate: "2026-11-22" }],
              }
            : m
        ),
      }),
    });
    fireEvent.click(cell(ANA, FRI));
    const dialog = await sheet();
    expect(within(dialog).getByTestId("roster-absence-71").textContent).toContain("20. 11.");
    expect(within(dialog).getByTestId("roster-absence-71").textContent).toContain("22. 11.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Odstrani odsotnost" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deskTrpc.removeAbsence).toHaveBeenCalledWith({ absenceId: 71 });
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(1);
  });

  it("both actions are disabled with the hint while the draft is dirty", async () => {
    renderRoster();
    await applyChoice(BOR, TUE, "Prosto");
    fireEvent.click(cell(ANA, TUE));
    let dialog = await sheet();
    expect(
      (within(dialog).getByRole("button", { name: "Dodaj odsotnost" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(within(dialog).getByText("Najprej shranite ali zavrzite spremembe urnika.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Prekliči" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(cell(ANA, FRI));
    dialog = await sheet();
    expect(
      (within(dialog).getByRole("button", { name: "Odstrani odsotnost" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(deskTrpc.addAbsence).not.toHaveBeenCalled();
    expect(deskTrpc.removeAbsence).not.toHaveBeenCalled();
  });

  it("no reason field anywhere in the sheet", async () => {
    renderRoster();
    fireEvent.click(cell(ANA, TUE));
    const dialog = await sheet();
    expect(within(dialog).queryByLabelText(/razlog/i)).toBeNull();
    expect(within(dialog).queryByPlaceholderText(/razlog/i)).toBeNull();
  });

  it("„Običajni teden“ has no absence section", async () => {
    renderRoster({ mode: "usual" });
    fireEvent.click(cell(ANA, "tue"));
    const dialog = await sheet();
    expect(within(dialog).queryByRole("button", { name: "Dodaj odsotnost" })).toBeNull();
    expect(within(dialog).queryByTestId("roster-absence")).toBeNull();
  });

  it("a worker adds an absence for their own row; other rows have no sheet", async () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", false));
    deskTrpc.addAbsence.mockResolvedValueOnce({ status: "saved", absenceId: 92 });
    renderRoster({ view: rosterWeek({ canEditUsualWeek: false, editableMemberIds: [ANA] }) });
    expect(cell(BOR, TUE).tagName).toBe("DIV");
    fireEvent.click(cell(ANA, TUE));
    fireEvent.click(within(sheetDialog()).getByRole("button", { name: "Dodaj odsotnost" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deskTrpc.addAbsence).toHaveBeenCalledWith({
      memberId: ANA,
      startDate: TUE,
      endDate: TUE,
      confirm: false,
    });
  });

  it("STAFF (no editable row) and a read-only week open no sheet, so no absence action", () => {
    me.mockReturnValue(businessMe(OLGA, "STAFF", false));
    renderRoster({ view: rosterWeek({ canEditUsualWeek: false, editableMemberIds: [] }) });
    fireEvent.click(cell(ANA, TUE));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    me.mockReturnValue(businessMe(OLGA, "OWNER", false));
    renderRoster({ view: rosterWeek({ weekStart: "2026-11-09" }) });
    fireEvent.click(cell(ANA, "2026-11-10"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// Flowko U29c (P7): DeskView scopes the draft to no week outside Urnik and renders RosterView only inside it.
function DeskHarness(props: { inRoster: boolean }) {
  const view = rosterWeek();
  const draft = useRosterDraft(props.inRoster ? view.weekStart : "", "week");
  captured.draft = draft;
  return (
    <TooltipProvider>
      {props.inRoster ? (
        <RosterView
          view={view}
          isPending={false}
          mode="week"
          date={DATE}
          today={DATE}
          isPhone={false}
          draft={draft}
          guard={spies.guard}
          onOpenDay={spies.onOpenDay}
          onModeChange={spies.onModeChange}
        />
      ) : (
        <div data-testid="dan-view" />
      )}
    </TooltipProvider>
  );
}

describe("RosterView editing: A → Dan → A while a save or copy runs (U29c P7)", () => {
  const FRI = "2026-11-20";

  function renderDesk() {
    const utils = render(<DeskHarness inRoster />);
    const toDan = () => utils.rerender(<DeskHarness inRoster={false} />);
    const backToUrnik = () => utils.rerender(<DeskHarness inRoster />);
    return { toDan, backToUrnik };
  }

  it("a save that finishes after the user came back to the same week keeps the new edit", async () => {
    const save = deferred<{ status: "saved" }>();
    deskTrpc.saveWeek.mockReturnValueOnce(save.promise);
    const { toDan, backToUrnik } = renderDesk();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    await waitFor(() => expect(deskTrpc.saveWeek).toHaveBeenCalledTimes(1));
    toDan();
    expect(captured.draft?.dirty).toBe(false);
    backToUrnik();
    // A fresh RosterView: the cells are tappable again while the first save is still in flight.
    await applyChoice(BOR, FRI, "Prosto");
    expect(captured.draft?.changedCount).toBe(1);
    await act(async () => {
      save.resolve({ status: "saved" });
    });
    await waitFor(() => expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured.draft?.changedCount).toBe(1);
    expect(cell(BOR, FRI).getAttribute("data-changed")).toBe("true");
    expect(screen.getByTestId("roster-save-count").textContent).toBe("1 sprememba");
    // The first save stood: „Shranjeno“ (the global toast outlives the RosterView it started in).
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Shranjeno", "success"));
  });

  it("a copy that finishes after the user came back to the same week fills nothing", async () => {
    const fetching = deferred<RosterWeekView>();
    deskTrpc.fetchRosterWeek.mockReturnValueOnce(fetching.promise);
    const { toDan, backToUrnik } = renderDesk();
    fireEvent.click(screen.getByRole("button", { name: "Kopiraj prejšnji teden" }));
    await waitFor(() => expect(deskTrpc.fetchRosterWeek).toHaveBeenCalledWith({ weekStart: "2026-11-09" }));
    toDan();
    backToUrnik();
    await applyChoice(BOR, FRI, "Prosto");
    const previous = rosterWeek({ weekStart: "2026-11-09" });
    await act(async () => {
      fetching.resolve({
        ...previous,
        members: previous.members.map((m) =>
          m.memberId === ANA
            ? { ...m, days: m.days.map((d) => ({ ...d, source: "planned" as const, entries: [] })) }
            : m
        ),
      });
    });
    expect(captured.draft?.changedCount).toBe(1);
    expect(cell(BOR, FRI).getAttribute("data-changed")).toBe("true");
    expect(cell(ANA, TUE).getAttribute("data-changed")).toBeNull();
  });
});

describe("RosterView editing: „Shranjeno“ (U29c P8)", () => {
  it("a saved week shows „Shranjeno“ once, after the refresh", async () => {
    const refresh = deferred();
    deskTrpc.invalidateRosterWeek.mockReturnValue(refresh.promise);
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    await waitFor(() => expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
    await act(async () => {
      refresh.resolve();
    });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Shranjeno", "success"));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("roster-refresh-failed")).toBeNull();
  });

  it("a saved usual week shows „Shranjeno“", async () => {
    renderRoster({ mode: "usual" });
    await applyChoice(ANA, "sat", "Prosto");
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Shranjeno", "success"));
  });

  it("needs_confirm is no save: no „Shranjeno“ until „Vseeno shrani“ is saved", async () => {
    deskTrpc.saveWeek.mockResolvedValueOnce({
      status: "needs_confirm",
      warnings: [{ memberId: ANA, outsideOpening: [TUE], bookingsNewlyOutside: 1 }],
    });
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole("dialog", { name: "Opozorilo pred shranjevanjem" });
    expect(toast).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Vseeno shrani" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Shranjeno", "success"));
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("„Kopiraj prejšnji teden“ is no save: no toast", async () => {
    deskTrpc.fetchRosterWeek.mockResolvedValue(rosterWeek({ weekStart: "2026-11-09" }));
    renderRoster();
    fireEvent.click(screen.getByRole("button", { name: "Kopiraj prejšnji teden" }));
    await waitFor(() => expect(deskTrpc.fetchRosterWeek).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Kopiraj prejšnji teden" })).toBeTruthy());
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("RosterView editing: the refresh-failed notice (U29c P1)", () => {
  const FRI = "2026-11-20";
  const NOTICE =
    "Shranjeno, Urnika pa ni bilo mogoče osvežiti. Pred novim shranjevanjem kliknite Poskusi znova.";
  const notice = () => screen.findByTestId("roster-refresh-failed");
  const retryButton = () =>
    within(screen.getByTestId("roster-refresh-failed")).getByRole("button", { name: "Poskusi znova" });

  it("a saved week whose refresh failed: the save stands, the notice shows, „Shrani“ waits for a retry", async () => {
    deskTrpc.invalidateRosterWeek.mockRejectedValue(new Error("network"));
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    expect((await notice()).textContent).toContain(NOTICE);
    expect(toast).toHaveBeenCalledWith("Shranjeno", "success");
    // The save stands: the draft is gone.
    expect(captured.draft?.dirty).toBe(false);
    expect(screen.queryByTestId("roster-save-bar")).toBeNull();
    // A new edit is possible, but „Shrani“ is held back (the versions are stale); „Zavrzi“ still works.
    await applyChoice(BOR, FRI, "Prosto");
    expect(saveButton().disabled).toBe(true);
    expect((within(bar()).getByRole("button", { name: "Zavrzi" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(deskTrpc.saveWeek).toHaveBeenCalledTimes(1);
    // A retry that fails again keeps the notice.
    fireEvent.click(retryButton());
    await waitFor(() => expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((retryButton() as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("roster-refresh-failed")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    // A retry that works removes it and frees „Shrani“.
    deskTrpc.invalidateRosterWeek.mockResolvedValue(undefined);
    fireEvent.click(retryButton());
    await waitFor(() => expect(screen.queryByTestId("roster-refresh-failed")).toBeNull());
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenLastCalledWith(undefined, undefined, {
      throwOnError: true,
    });
    expect(deskTrpc.invalidateDay).toHaveBeenCalledTimes(3);
    expect(saveButton().disabled).toBe(false);
  });

  it("a saved absence whose refresh failed shows the notice in Urnik after the sheet closed", async () => {
    deskTrpc.addAbsence.mockResolvedValueOnce({ status: "saved", absenceId: 90 });
    deskTrpc.invalidateRosterWeek.mockRejectedValue(new Error("network"));
    renderRoster();
    fireEvent.click(cell(ANA, TUE));
    fireEvent.click(within(await sheet()).getByRole("button", { name: "Dodaj odsotnost" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await notice()).textContent).toContain(NOTICE);
    expect(toast).toHaveBeenCalledWith("Shranjeno", "success");
    await applyChoice(BOR, FRI, "Prosto");
    expect(saveButton().disabled).toBe(true);
  });

  it("a saved holiday change whose refresh failed shows the notice in Urnik", async () => {
    deskTrpc.setHolidayOpen.mockResolvedValueOnce({ status: "saved" });
    deskTrpc.invalidateRosterWeek.mockRejectedValue(new Error("network"));
    const base = rosterWeek();
    renderRoster({
      view: {
        ...base,
        days: base.days.map((d) =>
          d.date === "2026-11-19" ? { ...d, holiday: { name: "Božič", open: false } } : d
        ),
      },
    });
    fireEvent.click(screen.getByTestId("roster-holiday-2026-11-19"));
    fireEvent.click(screen.getByRole("button", { name: "Odpri ta dan" }));
    expect((await notice()).textContent).toContain(NOTICE);
    expect(deskTrpc.setHolidayOpen).toHaveBeenCalledWith({ date: "2026-11-19", open: true });
    expect(deskTrpc.invalidateSettings).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Shranjeno", "success");
  });

  it("roster_changed (nothing saved) raises no notice even when the refresh fails", async () => {
    deskTrpc.saveWeek.mockRejectedValueOnce(trpcError("roster_changed"));
    deskTrpc.invalidateRosterWeek.mockRejectedValue(new Error("network"));
    renderRoster();
    await applyChoice(ANA, TUE, "Prosto");
    fireEvent.click(saveButton());
    await screen.findByTestId("roster-stale");
    await waitFor(() => expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalled());
    expect(screen.queryByTestId("roster-refresh-failed")).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });
});
