// Flowko U29b (Task 9, S7, D12): absences from a cell sheet. Add (start = the cell's date, end defaults to the same
// date, editable) → addAbsence with confirm false; needs_confirm → a plural booking count, „Vseeno dodaj“ resends
// with confirm true, „Prekliči“ saves nothing; saved → refresh, then the sheet closes. The stored absence a cell shows
// is listed with its range and removed whole (removeAbsence). Both actions are off while the draft is dirty (hint).
// No reason field. Errors are toasts from rosterErrors. Flowko U29c (P1, P8, R11): a saved add or removal shows
// „Shranjeno“ and hands the refresh's answer to onRefreshed (false = RosterView's notice); the sheet still closes.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsenceSection } from "./AbsenceSection";
import { ANA, localeT } from "./desk.fixture";
import { deskTrpc, resetDeskTrpc, trpcError } from "./desk.testDoubles";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Flowko U29e (E10.1): the language is switchable (en dates carry a „/“ that i18next would escape).
const loc = vi.hoisted(() => ({ lang: "sl" as "sl" | "en" }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT(loc.lang), i18n: { language: loc.lang } }),
}));
vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
const toast = vi.hoisted(() => vi.fn());
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => toast(...args) }));

const onDone = vi.fn();
const onRefreshed = vi.fn();
const TUE = "2026-11-17";

function section(over: Partial<Parameters<typeof AbsenceSection>[0]> = {}) {
  return render(
    <AbsenceSection
      memberId={ANA}
      date={TUE}
      today="2026-11-16"
      absences={[]}
      dirty={false}
      onDone={onDone}
      onRefreshed={onRefreshed}
      {...over}
    />
  );
}
const endField = () => screen.getByLabelText("Zadnji dan odsotnosti") as HTMLInputElement;
const addButton = () => screen.getByRole("button", { name: "Dodaj odsotnost" }) as HTMLButtonElement;
const removeButton = () => screen.getByRole("button", { name: "Odstrani odsotnost" }) as HTMLButtonElement;

beforeEach(() => {
  loc.lang = "sl";
  onDone.mockReset();
  onRefreshed.mockReset();
  toast.mockReset();
  resetDeskTrpc();
  deskTrpc.addAbsence.mockResolvedValue({ status: "saved", absenceId: 80 });
  deskTrpc.removeAbsence.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("AbsenceSection: add (S7, D12)", () => {
  it("the end date defaults to the cell's date and the range is sent with confirm false", async () => {
    section();
    expect(endField().value).toBe(TUE);
    fireEvent.change(endField(), { target: { value: "2026-11-18" } });
    fireEvent.click(addButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(deskTrpc.addAbsence).toHaveBeenCalledWith({
      memberId: ANA,
      startDate: TUE,
      endDate: "2026-11-18",
      confirm: false,
    });
  });

  it("with no change the absence is the one day", async () => {
    section();
    fireEvent.click(addButton());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(deskTrpc.addAbsence).toHaveBeenCalledWith({
      memberId: ANA,
      startDate: TUE,
      endDate: TUE,
      confirm: false,
    });
  });

  it("saved: the roster is refreshed first, then the sheet closes", async () => {
    let refreshed = false;
    deskTrpc.invalidateRosterWeek.mockImplementation(async () => {
      await Promise.resolve();
      refreshed = true;
    });
    section();
    fireEvent.click(addButton());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(refreshed).toBe(true);
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(1);
    expect(deskTrpc.invalidateDay).toHaveBeenCalled();
  });

  it.each([
    [1, "1 termin v tem času ostane v koledarju"],
    [2, "2 termina v tem času ostaneta v koledarju"],
    [3, "3 termini v tem času ostanejo v koledarju"],
    [5, "5 terminov v tem času ostane v koledarju"],
  ])("needs_confirm with %i bookings asks in the plural form", async (bookings, text) => {
    deskTrpc.addAbsence.mockResolvedValueOnce({ status: "needs_confirm", bookings });
    section();
    fireEvent.click(addButton());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(text)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(deskTrpc.invalidateRosterWeek).not.toHaveBeenCalled();
  });

  it("„Vseeno dodaj“ resends with confirm true, then refreshes and closes the sheet", async () => {
    deskTrpc.addAbsence.mockResolvedValueOnce({ status: "needs_confirm", bookings: 2 });
    section();
    fireEvent.change(endField(), { target: { value: "2026-11-18" } });
    fireEvent.click(addButton());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Vseeno dodaj" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(deskTrpc.addAbsence).toHaveBeenCalledTimes(2);
    expect(deskTrpc.addAbsence).toHaveBeenLastCalledWith({
      memberId: ANA,
      startDate: TUE,
      endDate: "2026-11-18",
      confirm: true,
    });
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(1);
  });

  it("the confirm opens with „Prekliči“ focused, not „Vseeno dodaj“ (final review UI-3)", async () => {
    deskTrpc.addAbsence.mockResolvedValueOnce({ status: "needs_confirm", bookings: 1 });
    section();
    fireEvent.click(addButton());
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Prekliči" }))
    );
  });

  it("„Prekliči“ saves nothing and leaves the sheet open", async () => {
    deskTrpc.addAbsence.mockResolvedValueOnce({ status: "needs_confirm", bookings: 1 });
    section();
    fireEvent.click(addButton());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Prekliči" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deskTrpc.addAbsence).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(addButton().disabled).toBe(false);
  });

  it("an end before the start, or none, holds „Dodaj odsotnost“ back", () => {
    section();
    fireEvent.change(endField(), { target: { value: "2026-11-16" } });
    expect(addButton().disabled).toBe(true);
    fireEvent.change(endField(), { target: { value: "" } });
    expect(addButton().disabled).toBe(true);
    fireEvent.change(endField(), { target: { value: TUE } });
    expect(addButton().disabled).toBe(false);
  });

  it("has no reason field", () => {
    section({ absences: [{ id: 71, startDate: TUE, endDate: TUE }] });
    expect(screen.queryByLabelText(/razlog/i)).toBeNull();
    section();
    expect(screen.queryByLabelText(/razlog/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/razlog/i)).toBeNull();
  });

  it("a rejected add is a toast with the code's text; the sheet stays and the roster is read again", async () => {
    deskTrpc.addAbsence.mockRejectedValueOnce(trpcError("bad_absence"));
    section();
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Odsotnosti ni bilo mogoče shraniti. Preverite datume.", "error")
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(1);
    expect(addButton().disabled).toBe(false);
  });

  it("a second tap while the add runs does not send twice", async () => {
    let release!: (value: unknown) => void;
    deskTrpc.addAbsence.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    section();
    fireEvent.click(addButton());
    await waitFor(() => expect(addButton().disabled).toBe(true));
    fireEvent.click(addButton());
    expect(deskTrpc.addAbsence).toHaveBeenCalledTimes(1);
    release({ status: "saved", absenceId: 1 });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe("AbsenceSection: remove (S7, D12)", () => {
  const stored = [{ id: 71, startDate: "2026-11-16", endDate: "2026-11-18" }];

  it("shows the stored range and removes the whole absence by its id", async () => {
    section({ absences: stored });
    expect(screen.getByTestId("roster-absence-71").textContent).toContain("16. 11.");
    expect(screen.getByTestId("roster-absence-71").textContent).toContain("18. 11.");
    fireEvent.click(removeButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(deskTrpc.removeAbsence).toHaveBeenCalledWith({ absenceId: 71 });
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(1);
  });

  it("a one-day absence shows the one date", () => {
    section({ absences: [{ id: 72, startDate: TUE, endDate: TUE }] });
    expect(screen.getByTestId("roster-absence-72").textContent).toContain("17. 11.");
    expect(screen.getByTestId("roster-absence-72").textContent).not.toContain("–");
  });

  it("only the absences that cover the cell's date show; no add form beside them", () => {
    section({
      absences: [
        { id: 71, startDate: "2026-11-16", endDate: "2026-11-18" },
        { id: 73, startDate: "2026-11-20", endDate: "2026-11-21" },
      ],
    });
    expect(screen.getByTestId("roster-absence-71")).toBeTruthy();
    expect(screen.queryByTestId("roster-absence-73")).toBeNull();
    expect(screen.queryByRole("button", { name: "Dodaj odsotnost" })).toBeNull();
  });

  it("an absence that ended before today is not offered for removal", () => {
    section({ today: "2026-11-19", absences: stored });
    expect(screen.getByTestId("roster-absence-71")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Odstrani odsotnost" })).toBeNull();
  });

  it("a rejected removal is a toast and the roster is read again", async () => {
    deskTrpc.removeAbsence.mockRejectedValueOnce(trpcError("forbidden"));
    section({ absences: stored });
    fireEvent.click(removeButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Tega urnika ne smete spreminjati.", "error"));
    expect(onDone).not.toHaveBeenCalled();
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(1);
  });
});

describe("AbsenceSection: unsaved edits (S7)", () => {
  it("add is disabled with the hint while the draft is dirty", () => {
    section({ dirty: true });
    expect(addButton().disabled).toBe(true);
    expect(screen.getByText("Najprej shranite ali zavrzite spremembe urnika.")).toBeTruthy();
    fireEvent.click(addButton());
    expect(deskTrpc.addAbsence).not.toHaveBeenCalled();
  });

  it("remove is disabled with the hint while the draft is dirty", () => {
    section({ dirty: true, absences: [{ id: 71, startDate: TUE, endDate: TUE }] });
    expect(removeButton().disabled).toBe(true);
    expect(screen.getByText("Najprej shranite ali zavrzite spremembe urnika.")).toBeTruthy();
    fireEvent.click(removeButton());
    expect(deskTrpc.removeAbsence).not.toHaveBeenCalled();
  });

  it("clean: no hint", () => {
    section();
    expect(screen.queryByText("Najprej shranite ali zavrzite spremembe urnika.")).toBeNull();
  });
});

describe("AbsenceSection: „Shranjeno“ and the checked refresh (U29c P1, P8)", () => {
  const stored = [{ id: 71, startDate: "2026-11-16", endDate: "2026-11-18" }];

  it("a saved add shows „Shranjeno“ and reports the working refresh (true)", async () => {
    section();
    fireEvent.click(addButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith("Shranjeno", "success");
    expect(onRefreshed).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("a saved removal shows „Shranjeno“", async () => {
    section({ absences: stored });
    fireEvent.click(removeButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith("Shranjeno", "success");
  });

  it("needs_confirm is no save: no „Shranjeno“", async () => {
    deskTrpc.addAbsence.mockResolvedValueOnce({ status: "needs_confirm", bookings: 1 });
    section();
    fireEvent.click(addButton());
    await screen.findByRole("dialog");
    expect(toast).not.toHaveBeenCalled();
  });

  it("a rejected add shows no „Shranjeno“ and no refresh-failed call", async () => {
    deskTrpc.addAbsence.mockRejectedValueOnce(trpcError("bad_absence"));
    deskTrpc.invalidateRosterWeek.mockRejectedValue(new Error("network"));
    section();
    fireEvent.click(addButton());
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast).not.toHaveBeenCalledWith("Shranjeno", "success");
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it.each([
    ["add", false],
    ["remove", true],
  ])("a failed roster.week refresh after a saved %s: „Shranjeno“, onRefreshed(false), the sheet still closes", async (_, removing) => {
    deskTrpc.invalidateRosterWeek.mockRejectedValue(new Error("network"));
    section(removing ? { absences: stored } : {});
    fireEvent.click(removing ? removeButton() : addButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onRefreshed).toHaveBeenCalledExactlyOnceWith(false);
    expect(toast).toHaveBeenCalledWith("Shranjeno", "success");
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  });
});

// Flowko U29e: E10.1 — en dates („Tue, 11/17“) are not escaped (no „&#x2F;“).
describe("AbsenceSection dates in English (U29e E10.1)", () => {
  it("a range and a one-day absence show their dates with „/“ once", () => {
    loc.lang = "en";
    section({ absences: [{ id: 71, startDate: "2026-11-16", endDate: "2026-11-18" }], date: "2026-11-16" });
    const text = screen.getByTestId("roster-absence-71").textContent ?? "";
    expect(text).toContain("11/16");
    expect(text).toContain("11/18");
    expect(text).not.toContain("&#x2F;");
    cleanup();
    section({ absences: [{ id: 72, startDate: TUE, endDate: TUE }] });
    expect(screen.getByTestId("roster-absence-72").textContent).toContain("11/17");
    expect(screen.getByTestId("roster-absence-72").textContent).not.toContain("&#x2F;");
  });
});
