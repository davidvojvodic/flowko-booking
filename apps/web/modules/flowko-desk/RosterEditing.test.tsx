// Flowko U29b (Task 8, S12–S16, D6–D11, Review Focus 4 and 6): editing in Urnik: a tappable cell opens the cell sheet,
// „Uporabi“ writes only the draft (highlight, no web storage, no mutation), the save bar, the save flow (saved after
// the refresh, needs_confirm → warnings → resend, roster_changed → discard + refetch + alert, other codes → toasts),
// „Običajni teden“ (planned-weeks note) and „Kopiraj prejšnji teden“.
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

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
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
    const dialog = screen.getByRole("dialog", { name: "Zavrzi spremembe?" });
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
