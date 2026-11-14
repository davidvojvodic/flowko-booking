// Flowko U29f: screen, within for the calendar cases.
import { render, fireEvent, screen, within } from "@testing-library/react";
import { format } from "date-fns";
// Flowko U29f: the Slovene date-fns locale for the calendarProps pass-through cases.
import { sl } from "date-fns/locale/sl";
import type { ReactElement } from "react";
import { vi } from "vitest";

import DatePicker from "./DatePicker";

const onChangeMock = vi.fn();

describe("Tests for DatePicker Component", () => {
  const testDate = new Date("2024-02-20");

  test("Should render correctly with default date", () => {
    const testDate = new Date("2024-02-20");
    const { getByTestId } = render(<DatePicker date={testDate} />);

    const dateButton = getByTestId("pick-date");
    expect(dateButton).toHaveTextContent(format(testDate, "LLL dd, y"));
  });

  test("Should show placeholder when no date is provided", () => {
    const { getByTestId } = render(<DatePicker date={null as unknown as Date} />);

    const dateButton = getByTestId("pick-date");
    expect(dateButton).toHaveTextContent("pick_a_date");
  });

  test("Should handle date selection correctly", async () => {
    const testDate = new Date("2024-02-20");
    const { getByTestId, getAllByRole } = render(<DatePicker date={testDate} onDatesChange={onChangeMock} />);

    const dateButton = getByTestId("pick-date");
    fireEvent.click(dateButton);
    const gridCells = getAllByRole("gridcell");
    const selectedDate = gridCells.find((cell) => {
      return cell.getAttribute("tabindex") === "0";
    });

    expect(selectedDate).toBeTruthy();
    await expect(selectedDate).not.toHaveClass("opacity-50");
  });
  test("Should respect minDate prop", async () => {
    const testDate = new Date("2024-02-20");
    const minDate = new Date("2024-02-19");
    const { getByTestId, getAllByRole } = render(
      <DatePicker date={testDate} minDate={minDate} onDatesChange={onChangeMock} />
    );

    const dateButton = getByTestId("pick-date");
    fireEvent.click(dateButton);

    const disabledDates = getAllByRole("gridcell").filter((cell) => cell.classList.contains("opacity-50"));
    expect(disabledDates.length).toBeGreaterThan(0);
    await expect(disabledDates[0]).toHaveAttribute("disabled");
  });

  test("Should respect disabled prop", () => {
    const { getByTestId } = render(<DatePicker date={testDate} disabled={true} />);

    const dateButton = getByTestId("pick-date");
    expect(dateButton.classList.toString()).toContain("disabled:cursor-not-allowed");
    expect(dateButton.classList.toString()).toContain("disabled:opacity-30");
  });
});

// Flowko U29f: selected day in the brand pair for every caller (R1 amended, R4), and the optional
// calendarProps pass-through (locale, week start, classNames, labels, today, outside days) for the desk.
describe("Flowko U29f: DatePicker calendar", () => {
  const december = new Date(2026, 11, 1);

  function open(ui: ReactElement) {
    render(ui);
    fireEvent.click(screen.getByTestId("pick-date"));
    return within(screen.getByRole("grid"));
  }

  function captionTexts() {
    return screen
      .getAllByText(
        (_, el) =>
          el?.tagName === "DIV" && el.childElementCount === 2 && el.firstElementChild?.tagName === "SPAN"
      )
      .map((el) => el.textContent);
  }

  function selectedDay(grid: ReturnType<typeof within>) {
    const selected = grid
      .getAllByRole("gridcell")
      .filter((c: HTMLElement) => c.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    return selected[0];
  }

  function classTokens(el: Element) {
    return el.getAttribute("class")?.split(/\s+/) ?? [];
  }

  test("without calendarProps: dayjs caption, Sunday first, brand selected day", () => {
    const grid = open(<DatePicker date={december} minDate={null} />);

    expect(captionTexts()).toEqual(["December 2026"]);
    const headers = grid.getAllByRole("columnheader");
    expect(headers[0]).toHaveTextContent("Su");
    expect(headers[0]).toHaveAttribute("aria-label", "Sunday");
    expect(headers[0].className).toContain("text-sm");

    const tokens = classTokens(selectedDay(grid));
    expect(tokens).toContain("bg-brand-default!");
    expect(tokens).toContain("text-brand!");
    expect(tokens).toContain("focus-visible:ring-2!");
    expect(tokens).toContain("focus-visible:ring-brand-default!");
    expect(tokens).toContain("focus-visible:ring-offset-2!");
    expect(tokens).not.toContain("bg-inverted");
    expect(tokens).not.toContain("text-inverted");
  });

  test("without calendarProps: outside days still shown (unchanged default)", () => {
    const grid = open(<DatePicker date={december} minDate={null} />);
    // 30 Nov (outside, first row) and 30 Dec.
    expect(grid.getAllByRole("gridcell").filter((c) => c.textContent === "30")).toHaveLength(2);
  });

  test("locale sl + weekStartsOn 1: Slovene caption and Monday first", () => {
    const grid = open(
      <DatePicker date={december} minDate={null} calendarProps={{ locale: sl, weekStartsOn: 1 }} />
    );

    expect(captionTexts()).toEqual(["december 2026"]);
    const headers = grid.getAllByRole("columnheader");
    expect(headers[0]).toHaveTextContent("pon.");
    expect(headers[0]).toHaveAttribute("aria-label", "ponedeljek");
    expect(headers[6]).toHaveTextContent("ned.");
  });

  test("classNames are merged into the defaults, components are kept", () => {
    const grid = open(
      <DatePicker
        date={december}
        minDate={null}
        calendarProps={{ classNames: { day_selected: "u29f-selected" } }}
      />
    );

    const tokens = classTokens(selectedDay(grid));
    expect(tokens).toContain("u29f-selected");
    expect(tokens).not.toContain("bg-brand-default!");
    // Other default keys survive the merge.
    expect(tokens).toContain("w-8");
    expect(grid.getAllByRole("columnheader")[0].className).toContain("text-sm");
    // The prev/next icons (Calendar's own components) still render.
    expect(screen.getByRole("button", { name: "Go to previous month" }).querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Go to next month" }).querySelector("svg")).not.toBeNull();
  });

  test("labels pass through to the nav buttons", () => {
    open(
      <DatePicker
        date={december}
        minDate={null}
        calendarProps={{ labels: { labelPrevious: () => "u29f-prev", labelNext: () => "u29f-next" } }}
      />
    );

    expect(screen.getByRole("button", { name: "u29f-prev" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "u29f-next" })).toBeInTheDocument();
  });

  test("showOutsideDays false: no button for 30 Nov on the December page", () => {
    const grid = open(
      <DatePicker date={december} minDate={null} calendarProps={{ showOutsideDays: false }} />
    );

    const thirties = grid.getAllByRole("gridcell").filter((c) => c.textContent === "30");
    expect(thirties).toHaveLength(1);
    // The one left is 30 Dec: the first week row holds no "29" / "30".
    const firstWeek = grid.getAllByRole("row")[1];
    expect(within(firstWeek).queryByText("30")).toBeNull();
    expect(within(firstWeek).queryByText("29")).toBeNull();
  });

  test("today comes from calendarProps, not the clock", () => {
    const grid = open(
      <DatePicker
        date={new Date(2024, 1, 20)}
        minDate={null}
        calendarProps={{ today: new Date(2024, 1, 12), classNames: { day_today: "u29f-today" } }}
      />
    );

    const marked = grid.getAllByRole("gridcell").filter((c) => classTokens(c).includes("u29f-today"));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent("12");
  });
});
