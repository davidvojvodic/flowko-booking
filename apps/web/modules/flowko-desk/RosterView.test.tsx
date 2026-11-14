// Flowko U29b (Task 7, S1, S8, S9, S10, S11): Urnik's read view: visibility per role, the desktop grid, the phone
// day list, „Ta teden“ / „Običajni teden“, the differing-day markers, the day-header tap and the holiday header.
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";

import { RosterView } from "./RosterView";
import { ANA, BOR, CENE, DATE, OLGA, businessMe, localeT, rosterWeek } from "./desk.fixture";
import { deskTrpc, resetDeskTrpc } from "./desk.testDoubles";
import { type RosterDraft, useRosterDraft } from "./useRosterDraft";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigation.push }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));
const me = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoBusiness", () => ({ useFlowkoBusiness: () => me() }));
vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));

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
        receivedAt={0}
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

const cell = (memberId: number, key: string) => screen.getByTestId(`roster-cell-${memberId}-${key}`);
const rowIds = () =>
  screen
    .getAllByTestId(/^roster-row-/)
    .map((r) => Number(r.getAttribute("data-testid")?.replace("roster-row-", "")));
const allCells = () =>
  screen.getAllByTestId(/^roster-cell-\d+-/).filter((c) => c.hasAttribute("data-editable"));
const editableCells = () => allCells().filter((c) => c.getAttribute("data-editable") === "true");

/**
 * The week of the 16th with Thursday 19 a holiday (closed or open). Flowko U29e (R19): the server's lower-case name.
 */
function withHoliday(open: boolean, over: Partial<RosterWeekView> = {}): RosterWeekView {
  const base = rosterWeek(over);
  return {
    ...base,
    days: base.days.map((d) => (d.date === "2026-11-19" ? { ...d, holiday: { name: "božič", open } } : d)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDeskTrpc();
  spies.guard.mockImplementation((action: () => void) => action());
  me.mockReturnValue(businessMe(OLGA, "OWNER", false));
  captured.draft = null;
});
afterEach(cleanup);

describe("RosterView: loading", () => {
  it("shows the loading text until the answer is there", () => {
    renderRoster({ view: undefined, isPending: true });
    expect(screen.getByTestId("roster-view")).toBeTruthy();
    expect(screen.getByText("Nalaganje...")).toBeTruthy();
    expect(screen.queryByTestId("roster-grid")).toBeNull();
  });
});

describe("RosterView: visibility per role (S9, D14)", () => {
  it("OWNER: all column members but LOCKED Dan, every cell from today editable, the mode toggle", () => {
    renderRoster();
    expect(rowIds()).toEqual([OLGA, ANA, BOR, CENE]);
    expect(screen.queryByText("Dan")).toBeNull();
    expect(allCells()).toHaveLength(4 * 7);
    expect(editableCells()).toHaveLength(4 * 7);
    expect(screen.getByTestId("roster-mode-week")).toBeTruthy();
    expect(screen.getByTestId("roster-mode-usual")).toBeTruthy();
  });

  it("WORKER Ana: own row first and marked, only her cells editable, no mode toggle", () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", false));
    renderRoster({ view: rosterWeek({ canEditUsualWeek: false, editableMemberIds: [ANA] }) });
    expect(rowIds()).toEqual([ANA, OLGA, BOR, CENE]);
    expect(screen.getByTestId(`roster-row-${ANA}`).getAttribute("data-own")).toBe("true");
    expect(screen.getByTestId(`roster-row-${OLGA}`).getAttribute("data-own")).toBeNull();
    expect(editableCells().map((c) => c.getAttribute("data-testid")?.split("-")[2])).toEqual(
      Array(7).fill(String(ANA))
    );
    expect(cell(BOR, "2026-11-17").getAttribute("data-editable")).toBe("false");
    expect(screen.queryByTestId("roster-mode-usual")).toBeNull();
  });

  it("STAFF: reads the whole Urnik, nothing editable, no toggle", () => {
    me.mockReturnValue(businessMe(5, "STAFF", false));
    renderRoster({ view: rosterWeek({ canEditUsualWeek: false, editableMemberIds: [] }) });
    expect(rowIds()).toEqual([OLGA, ANA, BOR, CENE]);
    expect(screen.getByTestId(`roster-row-${OLGA}`).getAttribute("data-own")).toBeNull();
    expect(editableCells()).toHaveLength(0);
    expect(screen.queryByTestId("roster-mode-usual")).toBeNull();
  });

  it("a past week is read-only", () => {
    renderRoster({ view: rosterWeek({ weekStart: "2026-11-09" }), date: "2026-11-09" });
    expect(allCells()).toHaveLength(28);
    expect(editableCells()).toHaveLength(0);
  });

  it("in the current week only the days from today are editable", () => {
    renderRoster({ view: rosterWeek({ today: "2026-11-18" }), today: "2026-11-18" });
    expect(cell(ANA, "2026-11-17").getAttribute("data-editable")).toBe("false");
    expect(cell(ANA, "2026-11-18").getAttribute("data-editable")).toBe("true");
    expect(cell(ANA, "2026-11-22").getAttribute("data-editable")).toBe("true");
  });

  it("a week after lastWritableWeekStart is read-only", () => {
    renderRoster({
      view: rosterWeek({ weekStart: "2027-11-29", lastWritableWeekStart: "2027-11-22" }),
      date: "2027-11-29",
    });
    expect(editableCells()).toHaveLength(0);
  });

  it("a LOCKED member is hidden from a worker too", () => {
    me.mockReturnValue(businessMe(BOR, "WORKER", false));
    renderRoster({ view: rosterWeek({ canEditUsualWeek: false, editableMemberIds: [BOR] }) });
    expect(rowIds()).toEqual([BOR, OLGA, ANA, CENE]);
  });
});

describe("RosterView: the grid on tablet and desktop (S10)", () => {
  it("has the desk's scroll container, sticky corner, 7 sticky headers and a sticky name column", () => {
    renderRoster();
    const scroll = screen.getByTestId("roster-grid");
    expect(scroll.className).toContain("isolate");
    expect(scroll.className).toContain("overflow-auto");
    expect(scroll.className).toContain("rounded-md");
    expect(screen.getByTestId("roster-grid-corner").className).toContain("sticky left-0 top-0 z-50");
    expect(screen.getAllByTestId(/^roster-header-\d/)).toHaveLength(7);
    const columns = screen.getAllByTestId(/^roster-col-/);
    expect(columns).toHaveLength(7);
    for (const column of columns) expect(column.className).toContain("sticky top-0 z-40");
    expect(screen.getByTestId(`roster-name-${ANA}`).className).toContain("sticky left-0 z-40");
    expect(screen.queryByTestId("roster-day-list")).toBeNull();
  });

  it("shows the cell texts: shifts, „Prosto“, planned days and „Odsotnost“", () => {
    renderRoster();
    expect(cell(OLGA, "2026-11-16").textContent).toBe("08:00–16:00");
    expect(cell(ANA, "2026-11-22").textContent).toBe("Prosto"); // Sunday, no usual shift
    expect(cell(BOR, "2026-11-16").textContent).toBe("Prosto"); // Monday, Bor works Tue–Sat
    expect(cell(BOR, "2026-11-18").textContent).toContain("Prosto"); // planned day off
    expect(cell(BOR, "2026-11-19").textContent).toContain("10:00–14:00");
    expect(cell(ANA, "2026-11-20").textContent).toBe("Odsotnost");
    expect(cell(CENE, "2026-11-16").textContent).toBe("Prosto");
    expect(within(screen.getByTestId(`roster-name-${ANA}`)).getByText("Ana")).toBeTruthy();
  });

  it("marks planned days that differ from the usual week, and only those (S11)", () => {
    renderRoster();
    const marked = screen
      .getAllByTestId("roster-differs")
      .map((m) => m.closest("[data-testid^='roster-cell-']")?.getAttribute("data-testid"));
    expect(marked.sort()).toEqual([`roster-cell-${BOR}-2026-11-18`, `roster-cell-${BOR}-2026-11-19`]);
    expect(within(cell(OLGA, "2026-11-16")).queryByTestId("roster-differs")).toBeNull();
  });

  it("mutes entries that come from the usual week", () => {
    renderRoster();
    expect(within(cell(OLGA, "2026-11-16")).getByTestId("roster-cell-shift").className).toContain(
      "text-subtle"
    );
    expect(within(cell(BOR, "2026-11-19")).getByTestId("roster-cell-shift").className).not.toContain(
      "text-subtle"
    );
  });

  it("shows a changed cell from snapshot + draft with its highlight, and drops it when set back", () => {
    const view = rosterWeek();
    renderRoster({ view });
    act(() => captured.draft?.set(view, ANA, "2026-11-17", [{ from: "10:00", to: "14:00" }]));
    expect(cell(ANA, "2026-11-17").textContent).toContain("10:00–14:00");
    expect(cell(ANA, "2026-11-17").getAttribute("data-changed")).toBe("true");
    expect(within(cell(ANA, "2026-11-17")).getByTestId("roster-differs")).toBeTruthy();
    act(() => captured.draft?.set(view, ANA, "2026-11-17", null));
    expect(cell(ANA, "2026-11-17").getAttribute("data-changed")).toBeNull();
    expect(cell(ANA, "2026-11-17").textContent).toBe("08:00–16:00");
  });

  it("a cell reset to „Običajno“ in the draft shows the usual entries again, still highlighted", () => {
    const view = rosterWeek();
    renderRoster({ view });
    act(() => captured.draft?.set(view, BOR, "2026-11-19", null));
    expect(cell(BOR, "2026-11-19").getAttribute("data-changed")).toBe("true");
    expect(cell(BOR, "2026-11-19").textContent).toContain("12:00–19:00");
    expect(within(cell(BOR, "2026-11-19")).queryByTestId("roster-differs")).toBeNull();
  });

  it("greys the column of a closed holiday, not an open one", () => {
    const { unmount } = renderRoster({ view: withHoliday(false) });
    expect(cell(ANA, "2026-11-19").className).toContain("bg-muted");
    expect(cell(ANA, "2026-11-18").className).not.toContain("bg-muted");
    unmount();
    renderRoster({ view: withHoliday(true) });
    expect(cell(ANA, "2026-11-19").className).not.toContain("bg-muted");
  });
});

describe("RosterView: the phone day list (S10, D4)", () => {
  it("shows one day, all workers as cards, in the same order and with the own card first", () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", false));
    renderRoster({
      isPhone: true,
      date: "2026-11-18",
      view: rosterWeek({ canEditUsualWeek: false, editableMemberIds: [ANA] }),
    });
    expect(screen.getByTestId("roster-day-list")).toBeTruthy();
    expect(screen.queryByTestId("roster-grid")).toBeNull();
    expect(screen.getAllByTestId(/^roster-header-\d/)).toHaveLength(1);
    const cards = screen.getAllByTestId(/^roster-card-/).map((c) => c.getAttribute("data-testid"));
    expect(cards).toEqual([
      `roster-card-${ANA}`,
      `roster-card-${OLGA}`,
      `roster-card-${BOR}`,
      `roster-card-${CENE}`,
    ]);
    expect(screen.getByTestId(`roster-card-${ANA}`).getAttribute("data-own")).toBe("true");
    expect(cell(BOR, "2026-11-18").textContent).toContain("Prosto");
    expect(cell(ANA, "2026-11-18").getAttribute("data-editable")).toBe("true");
    expect(cell(OLGA, "2026-11-18").getAttribute("data-editable")).toBe("false");
    expect(screen.queryByTestId(`roster-cell-${ANA}-2026-11-17`)).toBeNull();
  });

  it("follows the date prop: another date inside the week shows that day", () => {
    const { rerender } = renderRoster({ isPhone: true, date: "2026-11-18" });
    expect(screen.queryByTestId(`roster-cell-${ANA}-2026-11-20`)).toBeNull();
    rerender(<Harness isPhone date="2026-11-20" />);
    expect(cell(ANA, "2026-11-20").textContent).toBe("Odsotnost");
  });

  it("keeps the draft when the phone shows another day of the week", () => {
    const view = rosterWeek();
    const { rerender } = renderRoster({ isPhone: true, date: "2026-11-17", view });
    act(() => captured.draft?.set(view, ANA, "2026-11-17", []));
    rerender(<Harness isPhone date="2026-11-18" view={view} />);
    rerender(<Harness isPhone date="2026-11-17" view={view} />);
    expect(cell(ANA, "2026-11-17").getAttribute("data-changed")).toBe("true");
  });
});

describe("RosterView: „Običajni teden“ (S1, S11)", () => {
  it("the toggle asks for the other mode", () => {
    renderRoster();
    fireEvent.click(screen.getByTestId("roster-mode-usual"));
    expect(spies.onModeChange).toHaveBeenCalledWith("usual");
    cleanup();
    renderRoster({ mode: "usual" });
    fireEvent.click(screen.getByTestId("roster-mode-week"));
    expect(spies.onModeChange).toHaveBeenCalledWith("week");
  });

  it("the toggle never calls the mode change for the mode already shown", () => {
    renderRoster({ mode: "usual" });
    fireEvent.click(screen.getByTestId("roster-mode-usual"));
    expect(spies.onModeChange).not.toHaveBeenCalled();
  });

  it("grid: weekday headers, no dates, no holiday label, no header button, usual entries per weekday", () => {
    renderRoster({ mode: "usual", view: withHoliday(false) });
    expect(screen.getAllByTestId(/^roster-weekday-/).map((h) => h.textContent)).toEqual([
      "ponedeljek",
      "torek",
      "sreda",
      "četrtek",
      "petek",
      "sobota",
      "nedelja",
    ]);
    expect(screen.queryAllByTestId(/^roster-header-\d/)).toHaveLength(0);
    expect(screen.queryByText(/Božič/)).toBeNull();
    expect(cell(ANA, "sat").textContent).toBe("08:00–13:00");
    expect(cell(BOR, "mon").textContent).toBe("Prosto");
    expect(cell(BOR, "tue").textContent).toBe("12:00–19:00");
    expect(screen.queryByTestId("roster-differs")).toBeNull();
    expect(editableCells()).toHaveLength(4 * 7);
    expect(cell(ANA, "sat").className).not.toContain("bg-muted");
  });

  it("grid: a changed weekday is highlighted", () => {
    const view = rosterWeek();
    renderRoster({ mode: "usual", view });
    act(() => captured.draft?.set(view, ANA, "wed", [{ from: "09:00", to: "12:00" }]));
    expect(cell(ANA, "wed").getAttribute("data-changed")).toBe("true");
    expect(cell(ANA, "wed").textContent).toBe("09:00–12:00");
  });

  it("phone: weekday arrows Mon…Sun with no wrap, no date, no change of the date", () => {
    renderRoster({ mode: "usual", isPhone: true, date: "2026-11-16" });
    const label = () => screen.getByTestId("roster-weekday-label").textContent;
    const prev = screen.getByRole("button", { name: "Prejšnji dan v tednu" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Naslednji dan v tednu" }) as HTMLButtonElement;
    expect(label()).toBe("ponedeljek");
    expect(prev.disabled).toBe(true);
    expect(cell(ANA, "mon").textContent).toBe("08:00–16:00");
    fireEvent.click(next);
    expect(label()).toBe("torek");
    expect(cell(BOR, "tue").textContent).toBe("12:00–19:00");
    for (let i = 0; i < 5; i += 1) fireEvent.click(next);
    expect(label()).toBe("nedelja");
    expect(next.disabled).toBe(true);
    fireEvent.click(next);
    expect(label()).toBe("nedelja");
    fireEvent.click(prev);
    expect(label()).toBe("sobota");
    expect(screen.queryAllByTestId(/^roster-header-\d/)).toHaveLength(0);
    expect(spies.guard).not.toHaveBeenCalled();
    expect(spies.onOpenDay).not.toHaveBeenCalled();
  });

  it("phone: switching from „Ta teden“ starts at the weekday of the date, not a stale one", () => {
    const view = rosterWeek();
    const { rerender } = renderRoster({ isPhone: true, date: "2026-11-17", view });
    rerender(<Harness isPhone date="2026-11-19" view={view} />);
    rerender(<Harness isPhone date="2026-11-19" mode="usual" view={view} />);
    expect(screen.getByTestId("roster-weekday-label").textContent).toBe("četrtek");
    fireEvent.click(screen.getByRole("button", { name: "Prejšnji dan v tednu" }));
    expect(screen.getByTestId("roster-weekday-label").textContent).toBe("sreda");
    // inside the usual week the arrows own the index: a changed date does not move it
    rerender(<Harness isPhone date="2026-11-21" mode="usual" view={view} />);
    expect(screen.getByTestId("roster-weekday-label").textContent).toBe("sreda");
  });

  it("phone: starts on the weekday of the date", () => {
    renderRoster({ mode: "usual", isPhone: true, date: "2026-11-19" });
    expect(screen.getByTestId("roster-weekday-label").textContent).toBe("četrtek");
  });
});

describe("RosterView: the day header (S1, S8)", () => {
  it("a tap on the date opens Dan for that date", () => {
    renderRoster();
    fireEvent.click(screen.getByTestId("roster-header-2026-11-18"));
    expect(spies.onOpenDay).toHaveBeenCalledWith("2026-11-18");
  });

  it("on the phone the day header does the same", () => {
    renderRoster({ isPhone: true, date: "2026-11-18" });
    fireEvent.click(screen.getByTestId("roster-header-2026-11-18"));
    expect(spies.onOpenDay).toHaveBeenCalledWith("2026-11-18");
  });

  it("the owner's tap on the holiday label opens the menu and does not navigate", () => {
    renderRoster({ view: withHoliday(false) });
    const label = screen.getByTestId("roster-holiday-2026-11-19");
    expect(label.textContent).toBe("Božič – zaprto");
    fireEvent.click(label);
    expect(spies.onOpenDay).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Odpri ta dan" })).toBeTruthy();
  });

  it("an open holiday offers „Zapri ta dan“", () => {
    renderRoster({ view: withHoliday(true) });
    const label = screen.getByTestId("roster-holiday-2026-11-19");
    expect(label.textContent).toBe("Božič – odprto");
    fireEvent.click(label);
    expect(screen.getByRole("button", { name: "Zapri ta dan" })).toBeTruthy();
  });

  it("with the closing switch off the owner gets the hint and the link, not an action", () => {
    renderRoster({ view: withHoliday(true, { holidaysClosed: false }) });
    fireEvent.click(screen.getByTestId("roster-holiday-2026-11-19"));
    expect(screen.getByRole("link", { name: "Odpri nastavitve podjetja" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zapri ta dan" })).toBeNull();
  });

  it("a worker sees the label only", () => {
    me.mockReturnValue(businessMe(ANA, "WORKER", false));
    renderRoster({ view: withHoliday(false, { canEditUsualWeek: false, editableMemberIds: [ANA] }) });
    const label = screen.getByTestId("roster-holiday-2026-11-19");
    expect(label.textContent).toBe("Božič – zaprto");
    expect(label.tagName).not.toBe("BUTTON");
  });

  it("STAFF sees the label only", () => {
    me.mockReturnValue(businessMe(5, "STAFF", false));
    renderRoster({ view: withHoliday(false, { canEditUsualWeek: false, editableMemberIds: [] }) });
    expect(screen.getByTestId("roster-holiday-2026-11-19").tagName).not.toBe("BUTTON");
  });

  it("a holiday in a past week or beyond the window is a label even for the owner", () => {
    const past = rosterWeek({ weekStart: "2026-11-09" });
    renderRoster({
      date: "2026-11-09",
      view: {
        ...past,
        days: past.days.map((d) =>
          d.date === "2026-11-12" ? { ...d, holiday: { name: "božič", open: false } } : d
        ),
      },
    });
    expect(screen.getByTestId("roster-holiday-2026-11-12").tagName).not.toBe("BUTTON");
  });

  it("while the draft is dirty the owner's menu action is disabled with a hint (Ruling R3)", () => {
    const view = withHoliday(false);
    renderRoster({ view });
    act(() => captured.draft?.set(view, ANA, "2026-11-17", []));
    fireEvent.click(screen.getByTestId("roster-holiday-2026-11-19"));
    expect((screen.getByRole("button", { name: "Odpri ta dan" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Najprej shranite ali zavrzite spremembe urnika.")).toBeTruthy();
    expect(deskTrpc.setHolidayOpen).not.toHaveBeenCalled();
  });
});

// Flowko U29c (Task 1c-i, P6): Urnik's text at tablet and desktop width: a two-line day header, no truncation, names
// that wrap to two lines, a name-track variable, smaller shift text and a stronger „differs“ dot.
describe("RosterView: Urnik text (U29c P6)", () => {
  it("the grid header is two lines inside the date button: short weekday (long from xl) and „17. 11.“", () => {
    renderRoster();
    const button = screen.getByTestId("roster-header-2026-11-17");
    expect(button.className).not.toContain("truncate");
    const weekday = within(button).getByTestId("roster-header-weekday");
    const date = within(button).getByTestId("roster-header-date");
    expect(date.textContent).toBe("17. 11.");
    expect(weekday.querySelector("[data-form='short']")?.textContent).toBe("tor.");
    expect(weekday.querySelector("[data-form='short']")?.className).toContain("xl:hidden");
    expect(weekday.querySelector("[data-form='long']")?.textContent).toBe("torek");
    expect(weekday.querySelector("[data-form='long']")?.className).toContain("hidden xl:inline");
    expect(weekday.className).toContain("block");
    expect(date.className).toContain("block");
    // 7 headers, each with its own weekday and date line.
    expect(screen.getAllByTestId("roster-header-weekday")).toHaveLength(7);
    expect(screen.getAllByTestId("roster-header-date")).toHaveLength(7);
  });

  it("a holiday day keeps its separate label below the two-line date button", () => {
    renderRoster({ view: withHoliday(false) });
    const label = screen.getByTestId("roster-holiday-2026-11-19");
    const button = screen.getByTestId("roster-header-2026-11-19");
    expect(button.contains(label)).toBe(false);
    expect(within(button).getByTestId("roster-header-date").textContent).toBe("19. 11.");
    expect(label.textContent).toBe("Božič – zaprto");
  });

  it("the phone list keeps its one-line header (variant list)", () => {
    renderRoster({ isPhone: true, date: "2026-11-18" });
    const button = screen.getByTestId("roster-header-2026-11-18");
    expect(button.textContent).toBe("sre., 18. 11.");
    expect(within(button).queryByTestId("roster-header-weekday")).toBeNull();
    expect(within(button).queryByTestId("roster-header-date")).toBeNull();
  });

  it("the name track is the CSS variable --roster-name (7rem, 10rem from xl)", () => {
    renderRoster();
    const inner = screen.getByTestId("roster-grid").firstElementChild as HTMLElement;
    expect(inner.className).toContain("[--roster-name:7rem]");
    expect(inner.className).toContain("xl:[--roster-name:10rem]");
    expect(inner.style.gridTemplateColumns).toMatch(/^var\(--roster-name\) /);
  });

  it("a name wraps to two lines with a title (no truncate)", () => {
    renderRoster();
    const name = within(screen.getByTestId(`roster-name-${ANA}`)).getByText("Ana");
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).toContain("break-words");
    expect(name.className).not.toContain("truncate");
    expect(name.getAttribute("title")).toBe("Ana");
  });

  it("a shift line is text-xs, tabular and nowrap in a px-1.5 cell", () => {
    renderRoster();
    const shift = within(cell(OLGA, "2026-11-16")).getByTestId("roster-cell-shift");
    expect(shift.className).toContain("text-xs tabular-nums whitespace-nowrap");
    expect(cell(OLGA, "2026-11-16").className).toContain("px-1.5");
  });

  it("the differs dot is the strong attention colour in the grid and on the phone list", () => {
    const { unmount } = renderRoster();
    const dots = screen.getAllByTestId("roster-differs");
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.className).toContain("bg-semantic-attention-emphasis");
      expect(dot.className).toContain("h-2.5 w-2.5");
      expect(dot.className).not.toContain("bg-attention ");
    }
    unmount();
    renderRoster({ isPhone: true, date: "2026-11-19" });
    const phoneDot = within(cell(BOR, "2026-11-19")).getByTestId("roster-differs");
    expect(phoneDot.className).toContain("bg-semantic-attention-emphasis");
    expect(phoneDot.className).toContain("ring-1");
  });
});
