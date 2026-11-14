// Flowko U28: the date bar: previous/next day, today, a date picker and the day/week toggle, all kept in the URL
// (?date=&view=&worker=). The week toggle is enabled from md up and disabled with a hint on a phone (D2).
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { enUS } from "date-fns/locale/en-US";
import { sl } from "date-fns/locale/sl";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DateBar, deskPickerLocale, useDeskParams } from "./DateBar";
import { localeT } from "./desk.fixture";

// Flowko U29f: the language is mutable so the picker cases can switch to English; reset after each test.
const lang = vi.hoisted(() => ({ value: "sl" }));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT(lang.value as "sl" | "en"), i18n: { language: lang.value } }),
}));

afterEach(() => {
  lang.value = "sl";
  vi.useRealTimers();
});

function Harness({ today, weekAvailable = true }: { today: string; weekAvailable?: boolean }) {
  const params = useDeskParams();
  // Flowko U29b: Urnik's mode reaches the bar as DeskView passes it.
  return (
    <>
      <span data-testid="params">{JSON.stringify(params.state)}</span>
      <DateBar
        date={params.state.date ?? today}
        today={today}
        view={params.state.view}
        weekAvailable={weekAvailable}
        rosterMode={params.state.rosterMode}
        onDateChange={params.setDate}
        onViewChange={params.setView}
      />
    </>
  );
}

function renderBar(searchParams: string, today = "2026-11-16", weekAvailable = true) {
  const onUrlUpdate = vi.fn<(e: UrlUpdateEvent) => void>();
  render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate} hasMemory>
      <TooltipProvider>
        <Harness today={today} weekAvailable={weekAvailable} />
      </TooltipProvider>
    </NuqsTestingAdapter>
  );
  const lastQuery = () => onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]?.[0].queryString;
  return { onUrlUpdate, lastQuery };
}

const params = () => JSON.parse(screen.getByTestId("params").textContent ?? "{}");

describe("DateBar (U28)", () => {
  it("reads date, view and worker from the URL, ignoring a malformed date", () => {
    renderBar("?date=2026-11-18&view=day&worker=3");
    // Flowko U29b: plus Urnik's mode, "week" by default
    expect(params()).toEqual({ date: "2026-11-18", view: "day", worker: 3, rosterMode: "week" });
  });

  it("falls back to today for a missing or malformed date", () => {
    renderBar("?date=2026-13-45");
    expect(params().date).toBeNull();
    expect(screen.getByTestId("pick-date").textContent).toContain("16");
  });

  it("steps to the previous and the next day", async () => {
    const { lastQuery } = renderBar("?date=2026-11-16");
    fireEvent.click(screen.getByRole("button", { name: "Prejšnji dan" }));
    await vi.waitFor(() => expect(lastQuery()).toBe("?date=2026-11-15"));
    // back on today the date leaves the URL, so the desk keeps following the clock
    fireEvent.click(screen.getByRole("button", { name: "Naslednji dan" }));
    await vi.waitFor(() => expect(lastQuery()).toBe(""));
    fireEvent.click(screen.getByRole("button", { name: "Naslednji dan" }));
    await vi.waitFor(() => expect(lastQuery()).toBe("?date=2026-11-17"));
  });

  it("„Danes“ drops the date from the URL and is disabled on today", async () => {
    const { lastQuery } = renderBar("?date=2026-11-20");
    fireEvent.click(screen.getByRole("button", { name: "Danes" }));
    await vi.waitFor(() => expect(lastQuery()).toBe(""));
    expect(screen.getByRole("button", { name: "Danes" })).toBeDisabled();
  });

  it("crosses a month and a DST change by calendar days", async () => {
    const { lastQuery } = renderBar("?date=2026-10-25");
    fireEvent.click(screen.getByRole("button", { name: "Naslednji dan" }));
    await vi.waitFor(() => expect(lastQuery()).toBe("?date=2026-10-26"));
  });

  it("shows the day toggle selected and the week toggle enabled", () => {
    renderBar("");
    expect(screen.getByRole("radio", { name: "Dan" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Teden" })).not.toBeDisabled();
    expect(screen.queryByTestId("desk-week-hint")).toBeNull();
  });

  it("choosing the week puts view=week in the URL", async () => {
    const { lastQuery } = renderBar("?date=2026-11-18");
    fireEvent.click(screen.getByRole("radio", { name: "Teden" }));
    await vi.waitFor(() => expect(lastQuery()).toContain("view=week"));
    expect(lastQuery()).toContain("date=2026-11-18");
  });

  it("disables the week toggle with a hint where the week view is not offered (phone)", () => {
    renderBar("", "2026-11-16", false);
    expect(screen.getByRole("radio", { name: "Teden" })).toBeDisabled();
    expect(screen.getByTestId("desk-week-hint").textContent).toBe(
      "Tedenski pogled je na voljo na tablici ali računalniku."
    );
  });

  it("in the week view previous/next step seven days and the label names the week", async () => {
    const { lastQuery } = renderBar("?view=week&date=2026-11-18");
    expect(screen.getByTestId("pick-date").textContent).toContain("16. november – 22. november 2026");
    fireEvent.click(screen.getByRole("button", { name: "Naslednji teden" }));
    await vi.waitFor(() => expect(lastQuery()).toContain("date=2026-11-25"));
    fireEvent.click(screen.getByRole("button", { name: "Prejšnji teden" }));
    await vi.waitFor(() => expect(lastQuery()).toContain("date=2026-11-18"));
    fireEvent.click(screen.getByRole("button", { name: "Prejšnji teden" }));
    await vi.waitFor(() => expect(lastQuery()).toContain("date=2026-11-11"));
  });

  it("stepping a week back onto today drops the date", async () => {
    const { lastQuery } = renderBar("?view=week&date=2026-11-23");
    fireEvent.click(screen.getByRole("button", { name: "Prejšnji teden" }));
    await vi.waitFor(() => expect(lastQuery()).not.toContain("date="));
  });
});

// Flowko U29b (S1): „Urnik“ is the third view on every size; it steps by week (week label) from md up and by day
// (day label) on a phone; in the usual week only the view toggle stays.
describe("DateBar Urnik (U29b S1)", () => {
  it("offers „Urnik“ next to Dan/Teden, also where the week view is not offered", async () => {
    const { lastQuery } = renderBar("?date=2026-11-18", "2026-11-16", false);
    expect(screen.getByRole("radio", { name: "Urnik" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Urnik" }));
    await vi.waitFor(() => expect(lastQuery()).toContain("view=roster"));
  });

  it("reads ?rosterMode=usual, and an unknown value falls back to the week", () => {
    renderBar("?view=roster&rosterMode=usual");
    expect(params()).toMatchObject({ view: "roster", rosterMode: "usual" });
    cleanup();
    renderBar("?view=roster&rosterMode=month");
    expect(params().rosterMode).toBe("week");
  });

  it("from md up steps a week with the week label", async () => {
    const { lastQuery } = renderBar("?view=roster&date=2026-11-18");
    expect(screen.getByTestId("pick-date").textContent).toContain("16. november – 22. november 2026");
    fireEvent.click(screen.getByRole("button", { name: "Naslednji teden" }));
    await vi.waitFor(() => expect(lastQuery()).toContain("date=2026-11-25"));
  });

  it("on a phone steps a day with the day label", async () => {
    const { lastQuery } = renderBar("?view=roster&date=2026-11-18", "2026-11-16", false);
    expect(screen.getByTestId("pick-date").textContent).toContain("sreda, 18. november 2026");
    fireEvent.click(screen.getByRole("button", { name: "Naslednji dan" }));
    await vi.waitFor(() => expect(lastQuery()).toContain("date=2026-11-19"));
  });

  it("the usual week hides the arrows, the date picker and „Danes“", () => {
    renderBar("?view=roster&rosterMode=usual&date=2026-11-18");
    expect(screen.queryByRole("button", { name: "Naslednji teden" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prejšnji teden" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Danes" })).toBeNull();
    expect(screen.queryByTestId("pick-date")).toBeNull();
    expect(screen.getByRole("radio", { name: "Urnik" })).toHaveAttribute("aria-checked", "true");
    // the mode only matters in Urnik: the day view keeps its bar
    cleanup();
    renderBar("?rosterMode=usual&date=2026-11-18");
    expect(screen.getByRole("button", { name: "Danes" })).toBeInTheDocument();
  });
});

// Flowko U29f (F1, R2–R7): the desk's date picker in Slovene, Monday first, the selected day in the brand pair,
// the business today marked, outside days hidden — the same in the day, week and Urnik views.
describe("DateBar date picker (U29f F1)", () => {
  /** Opens the popover; queries stay inside it, because the bar shows dates too. */
  function openPicker() {
    fireEvent.click(screen.getByTestId("pick-date"));
    const dialog = screen.getByRole("dialog");
    return { dialog: within(dialog), grid: within(within(dialog).getByRole("grid")) };
  }

  function caption(dialog: ReturnType<typeof within>) {
    return dialog
      .getAllByText(
        (_: string, el: Element | null) =>
          el?.tagName === "DIV" && el.childElementCount === 2 && el.firstElementChild?.tagName === "SPAN"
      )
      .map((el: HTMLElement) => el.textContent);
  }

  const tokens = (el: Element) => el.getAttribute("class")?.split(/\s+/) ?? [];

  function selectedDay(grid: ReturnType<typeof within>) {
    const selected = grid
      .getAllByRole("gridcell")
      .filter((c: HTMLElement) => c.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    return selected[0];
  }

  const SL_HEADERS = ["pon.", "tor.", "sre.", "čet.", "pet.", "sob.", "ned."];

  function expectDeskPicker(grid: ReturnType<typeof within>, dialog: ReturnType<typeof within>) {
    expect(caption(dialog)).toEqual(["december 2026"]);
    const headers = grid.getAllByRole("columnheader");
    expect(headers.map((h: HTMLElement) => h.textContent)).toEqual(SL_HEADERS);
    expect(headers[0]).toHaveAttribute("aria-label", "ponedeljek");
    expect(headers[6]).toHaveAttribute("aria-label", "nedelja");
    // Tue 1 Dec: Mon 30 Nov is an outside day, hidden → no day button in the first cell.
    const firstWeek = grid.getAllByRole("row")[1];
    const firstCell = firstWeek.querySelectorAll("td")[0];
    expect(firstCell.querySelector("button")).toBeNull();
    expect(firstWeek.querySelectorAll("button")[0]).toHaveTextContent("1");
    // The selected day: the brand pair, never Cal's near-black.
    const selected = selectedDay(grid);
    expect(selected).toHaveAttribute("name", "day");
    expect(selected).toHaveTextContent("1");
    expect(tokens(selected)).toContain("bg-brand-default!");
    expect(tokens(selected)).toContain("text-brand!");
    expect(tokens(selected)).not.toContain("bg-inverted");
    expect(dialog.getByRole("button", { name: "Prikaži prejšnji mesec" })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Prikaži naslednji mesec" })).toBeInTheDocument();
  }

  it("day view: Slovene caption and headers, Monday first, outside days hidden, brand selected day", () => {
    renderBar("?date=2026-12-01");
    const { dialog, grid } = openPicker();
    expectDeskPicker(grid, dialog);
  });

  it("header cells are smaller on a phone (text-xs md:text-sm)", () => {
    renderBar("?date=2026-12-01");
    const { grid } = openPicker();
    for (const header of grid.getAllByRole("columnheader")) {
      expect(tokens(header)).toContain("text-xs");
      expect(tokens(header)).toContain("md:text-sm");
      expect(tokens(header)).not.toContain("text-sm");
    }
  });

  it("the same picker in the week view and in Urnik's week", () => {
    renderBar("?view=week&date=2026-12-01");
    let picker = openPicker();
    expectDeskPicker(picker.grid, picker.dialog);
    cleanup();
    renderBar("?view=roster&date=2026-12-01");
    picker = openPicker();
    expectDeskPicker(picker.grid, picker.dialog);
    cleanup();
    // Urnik on a phone steps by day: still the same picker.
    renderBar("?view=roster&date=2026-12-01", "2026-11-16", false);
    picker = openPicker();
    expectDeskPicker(picker.grid, picker.dialog);
  });

  it("picking 2 Dec still puts the date in the URL", async () => {
    const { lastQuery } = renderBar("?date=2026-12-01");
    const { grid } = openPicker();
    fireEvent.click(grid.getByRole("gridcell", { name: "2" }));
    await vi.waitFor(() => expect(lastQuery()).toBe("?date=2026-12-02"));
  });

  it("Escape closes the picker without changing the bar", () => {
    const { onUrlUpdate } = renderBar("?date=2026-12-01");
    const label = screen.getByTestId("pick-date").textContent;
    openPicker();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("pick-date").textContent).toBe(label);
    expect(params()).toMatchObject({ date: "2026-12-01", view: "day" });
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });

  it("marks the business today, not the browser's", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // The browser's local day (TZ=UTC) is the 15th; the business today is the 16th.
    vi.setSystemTime(new Date("2026-11-15T23:30:00Z"));
    renderBar("?date=2026-11-20", "2026-11-16");
    const { grid } = openPicker();
    const day16 = grid.getByRole("gridcell", { name: "16" });
    const day15 = grid.getByRole("gridcell", { name: "15" });
    expect(tokens(day16)).toContain("border-brand-default!");
    expect(tokens(day16)).toContain("font-semibold!");
    expect(tokens(day15)).not.toContain("border-brand-default!");
    expect(tokens(day15)).not.toContain("font-semibold!");
  });

  it("in English: English caption, Monday still first, English nav labels", () => {
    lang.value = "en";
    renderBar("?date=2026-12-01");
    const { dialog, grid } = openPicker();
    expect(caption(dialog)).toEqual(["December 2026"]);
    const headers = grid.getAllByRole("columnheader");
    expect(headers[0]).toHaveTextContent("Mo");
    expect(headers[0]).toHaveAttribute("aria-label", "Monday");
    expect(headers[6]).toHaveTextContent("Su");
    expect(dialog.getByRole("button", { name: "View previous month" })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "View next month" })).toBeInTheDocument();
  });

  it("deskPickerLocale: Slovene unless the language is something else", () => {
    expect(deskPickerLocale("sl")).toBe(sl);
    expect(deskPickerLocale("sl-SI")).toBe(sl);
    expect(deskPickerLocale(undefined)).toBe(sl);
    expect(deskPickerLocale("en")).toBe(enUS);
  });
});
