// Flowko U28: the date bar: previous/next day, today, a date picker and the day/week toggle, all kept in the URL
// (?date=&view=&worker=). The week toggle is enabled from md up and disabled with a hint on a phone (D2).
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import { DateBar, useDeskParams } from "./DateBar";
import { localeT } from "./desk.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));

function Harness({ today, weekAvailable = true }: { today: string; weekAvailable?: boolean }) {
  const params = useDeskParams();
  return (
    <>
      <span data-testid="params">{JSON.stringify(params.state)}</span>
      <DateBar
        date={params.state.date ?? today}
        today={today}
        view={params.state.view}
        weekAvailable={weekAvailable}
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
    expect(params()).toEqual({ date: "2026-11-18", view: "day", worker: 3 });
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
