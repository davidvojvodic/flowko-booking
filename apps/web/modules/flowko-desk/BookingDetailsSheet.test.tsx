// Flowko U28: the booking details sheet (R5, R12, D4): what the booking is, its history („who did what“), and the
// actions its flags allow: move (tap mode or date + time), move to another worker, no-show and its undo, cancel
// with an optional reason. Every write carries the actor. Flowko U28c: „Prestavi“ opens a move panel in the sheet.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeskBooking } from "@calcom/features/flowkoBusiness/desk";

import { BookingDetailsSheet, historyLines } from "./BookingDetailsSheet";
import { ANA, BOR, OLGA, TZ, at, barvanje, iso, localeT } from "./desk.fixture";
import { DeskTestProvider, contextValue, deskTrpc, moveModeState, resetDeskTrpc } from "./desk.testDoubles";

vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));
const toast = vi.fn();
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => toast(...args) }));

const t = localeT("sl");
const all = { mayCancel: true, mayMove: true, mayNoShow: true, mayReenter: true };
const none = { mayCancel: false, mayMove: false, mayNoShow: false, mayReenter: false };

function renderDetails(booking: DeskBooking, over: Parameters<typeof contextValue>[0] = {}) {
  const ctx = contextValue(over);
  const onClose = vi.fn();
  render(
    <DeskTestProvider value={ctx}>
      <BookingDetailsSheet booking={booking} onClose={onClose} />
    </DeskTestProvider>
  );
  return { ctx, onClose };
}

const button = (name: string) => screen.queryByRole("button", { name });

// Flowko U28c: bookings.freeStarts for the move panel (Ana = barvanje's worker).
const freeAnswer = {
  date: "2026-11-16",
  timeZone: TZ,
  slotStepMinutes: 15,
  holiday: null,
  workers: [
    { memberId: ANA, displayName: "Ana", starts: [iso("10:40"), iso("11:00")], googleUnavailable: false },
    { memberId: BOR, displayName: "Bor", starts: [iso("13:30")], googleUnavailable: false },
  ],
};

describe("historyLines (U28 history)", () => {
  it("names who did what and when, overrides listed", () => {
    const lines = historyLines(
      [
        {
          kind: "CREATED",
          actorName: "Olga",
          at: "2026-11-15T10:00:00.000Z",
          details: { overrides: ["overlaps_booking", "outside_shift"] },
        },
        {
          kind: "RESCHEDULED",
          actorName: "Rok",
          at: "2026-11-15T12:00:00.000Z",
          details: { fromStart: iso("08:30"), toStart: iso("09:00") },
        },
        {
          kind: "RESCHEDULED",
          actorName: "Rok",
          at: "2026-11-15T12:05:00.000Z",
          details: { fromStart: iso("08:30", "2026-11-17"), toStart: iso("09:00"), overrides: ["time_off"] },
        },
        { kind: "NO_SHOW", actorName: "Olga", at: "2026-11-16T08:30:00.000Z", details: { noShow: true } },
        { kind: "NO_SHOW", actorName: null, at: "2026-11-16T08:40:00.000Z", details: { noShow: false } },
        { kind: "CANCELLED", actorName: "Ana", at: "2026-11-16T09:00:00.000Z", details: null },
      ],
      TZ,
      t
    );
    expect(lines).toEqual([
      "Ustvarjeno: Olga · 15. 11. 2026 11:00",
      "Shranjeno kljub opozorilom: prekrivanje s terminom, zunaj izmene",
      "Prestavljeno: Rok · 08:30 → 09:00 · 15. 11. 2026 13:00",
      "Prestavljeno: Rok · 17. 11. 08:30 → 16. 11. 09:00 · 15. 11. 2026 13:05",
      "Shranjeno kljub opozorilom: odsotnost",
      "Neprihod označil(a): Olga · 16. 11. 2026 09:30",
      "Neprihod preklical(a): neznano · 16. 11. 2026 09:40",
      "Odpovedano: Ana · 16. 11. 2026 10:00",
    ]);
  });

  it("skips actions it has no line for", () => {
    expect(
      historyLines([{ kind: "CONFIRMED", actorName: "Olga", at: iso("08:00"), details: null }], TZ, t)
    ).toEqual([]);
  });
});

describe("BookingDetailsSheet (U28)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    toast.mockReset();
  });

  it("shows title, time, steps, customer and history", () => {
    renderDetails({
      ...barvanje,
      actions: [{ kind: "CREATED", actorName: "Olga", at: "2026-11-15T10:00:00.000Z", details: null }],
    });
    expect(screen.getByRole("dialog", { name: "Barvanje" })).toBeInTheDocument();
    expect(screen.getByTestId("desk-details-time").textContent).toContain("09:00–10:40");
    expect(screen.getAllByTestId("desk-details-step").map((s) => s.textContent)).toEqual([
      "09:00–09:30 · Barvanje · Delo",
      "09:30–10:10 · Barvanje · Čakanje",
      "10:10–10:40 · Barvanje · Delo",
    ]);
    expect(screen.getByText("Marija Novak")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+38641123456" })).toHaveAttribute("href", "tel:+38641123456");
    expect(screen.getByRole("link", { name: "marija@example.com" })).toHaveAttribute(
      "href",
      "mailto:marija@example.com"
    );
    expect(screen.getAllByTestId("desk-history-line").map((l) => l.textContent)).toEqual([
      "Ustvarjeno: Olga · 15. 11. 2026 11:00",
    ]);
  });

  it("an untrusted step copy shows the whole span as one step", () => {
    renderDetails({ ...barvanje, steps: null, serviceNames: ["Barvanje", "Fen"] });
    expect(screen.getAllByTestId("desk-details-step").map((s) => s.textContent)).toEqual([
      "09:00–10:40 · Barvanje, Fen",
    ]);
  });

  it("buttons follow the flags", () => {
    renderDetails({ ...barvanje, ...all });
    for (const name of ["Prestavi", "Prestavi k drugemu delavcu", "Označi neprihod", "Odpovej termin"]) {
      expect(button(name)).not.toBeNull();
    }
  });

  it("a worker's own booking can be moved but not handed to another worker", () => {
    renderDetails({ ...barvanje, ...all, mayReenter: false, mayNoShow: false });
    expect(button("Prestavi")).not.toBeNull();
    expect(button("Prestavi k drugemu delavcu")).toBeNull();
    expect(button("Označi neprihod")).toBeNull();
  });

  it("a colleague's booking for a worker offers no action", () => {
    renderDetails({ ...barvanje, ...none });
    expect(screen.queryAllByRole("button", { name: /Prestavi|Odpovej|neprihod/i })).toEqual([]);
    expect(screen.queryByLabelText("Čas")).toBeNull();
  });

  // Flowko U28c (M1): one „Prestavi“ button; no date/time block until it is pressed.
  it("shows one „Prestavi“ and no date/time block by default", () => {
    renderDetails({ ...barvanje, ...all });
    expect(screen.getAllByRole("button", { name: "Prestavi" })).toHaveLength(1);
    expect(screen.queryByLabelText("Datum")).toBeNull();
    expect(screen.queryByLabelText("Čas")).toBeNull();
    expect(button("Potrdi prestavitev")).toBeNull();
    expect(button("Prestavi na izbrani čas")).toBeNull();
  });

  it("no mayMove: no „Prestavi“", () => {
    renderDetails({ ...barvanje, ...all, mayMove: false });
    expect(button("Prestavi")).toBeNull();
    expect(button("Prestavi k drugemu delavcu")).not.toBeNull();
  });

  // Flowko U28c (M2): „Prestavi“ opens the move panel inside the sheet; the details stay visible.
  it("„Prestavi“ opens the panel with the booking's date and that worker's free starts", () => {
    deskTrpc.freeStartsQuery.mockReturnValue({ data: freeAnswer, isFetching: false });
    const { ctx, onClose } = renderDetails({ ...barvanje, ...all });
    fireEvent.click(button("Prestavi") as HTMLElement);
    expect(ctx.moveMode.start).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const panel = screen.getByTestId("desk-move-panel");
    expect(within(panel).getByRole("heading", { name: "Prestavi termin" })).toBeInTheDocument();
    expect(screen.getByTestId("desk-details-time")).toBeInTheDocument();
    expect((screen.getByLabelText("Datum") as HTMLInputElement).value).toBe("2026-11-16");
    expect((screen.getByLabelText("Čas") as HTMLInputElement).value).toBe("");
    expect(deskTrpc.freeStartsQuery).toHaveBeenLastCalledWith(
      { date: "2026-11-16", serviceIds: [1] },
      expect.objectContaining({ enabled: true })
    );
    // Ana's starts, not Bor's.
    expect(screen.getAllByTestId("desk-free-start").map((c) => c.textContent)).toEqual(["10:40", "11:00"]);
    expect(button("Potrdi prestavitev")).toBeDisabled();
  });

  it("a chip fills Čas and „Potrdi prestavitev“ moves to that start", async () => {
    deskTrpc.freeStartsQuery.mockReturnValue({ data: freeAnswer, isFetching: false });
    const moveTo = vi.fn().mockResolvedValue({ kind: "done", data: {} });
    renderDetails({ ...barvanje, ...all }, { moveMode: moveModeState({ moveTo }) });
    fireEvent.click(button("Prestavi") as HTMLElement);
    fireEvent.click(screen.getAllByTestId("desk-free-start")[1]);
    expect((screen.getByLabelText("Čas") as HTMLInputElement).value).toBe("11:00");
    expect(button("Potrdi prestavitev")).not.toBeDisabled();
    fireEvent.click(button("Potrdi prestavitev") as HTMLElement);
    await waitFor(() =>
      expect(moveTo).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 101 }), at("11:00"), {
        fieldCodes: ["in_past"],
      })
    );
  });

  it("another date refetches the free starts; the typed time on that date is the start; in_past under the field", async () => {
    const moveTo = vi
      .fn()
      .mockResolvedValue({ kind: "error", code: "in_past", message: "flowko_desk_error_in_past" });
    renderDetails({ ...barvanje, ...all }, { moveMode: moveModeState({ moveTo }) });
    fireEvent.click(button("Prestavi") as HTMLElement);
    fireEvent.change(screen.getByLabelText("Datum"), { target: { value: "2026-11-24" } });
    expect(deskTrpc.freeStartsQuery).toHaveBeenLastCalledWith(
      { date: "2026-11-24", serviceIds: [1] },
      expect.objectContaining({ enabled: true })
    );
    fireEvent.change(screen.getByLabelText("Čas"), { target: { value: "12:00" } });
    fireEvent.click(button("Potrdi prestavitev") as HTMLElement);
    await waitFor(() =>
      expect(moveTo).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: 101 }),
        at("12:00", "2026-11-24"),
        { fieldCodes: ["in_past"] }
      )
    );
    expect(at("12:00", "2026-11-24")).toBe(Date.parse("2026-11-24T11:00:00.000Z"));
    expect(await screen.findByText("Termin je v preteklosti. Izberite poznejši čas.")).toBeInTheDocument();
  });

  it("services gone: a short note and only the time field", () => {
    renderDetails({ ...barvanje, ...all, serviceIds: null });
    fireEvent.click(button("Prestavi") as HTMLElement);
    expect(screen.getByTestId("desk-move-services-gone")).toBeInTheDocument();
    expect(screen.queryByText("Prosti termini")).toBeNull();
    expect(deskTrpc.freeStartsQuery).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Čas")).toBeInTheDocument();
  });

  it("„Prekliči“ closes the panel, back to the details", () => {
    renderDetails({ ...barvanje, ...all });
    fireEvent.click(button("Prestavi") as HTMLElement);
    fireEvent.click(within(screen.getByTestId("desk-move-panel")).getByRole("button", { name: "Prekliči" }));
    expect(screen.queryByTestId("desk-move-panel")).toBeNull();
    expect(button("Prestavi")).not.toBeNull();
  });

  // Flowko U28c (M3): the calendar route stays: the link starts today's tap mode and closes the sheet.
  it("„ali izberite čas na koledarju“ starts move mode and closes the sheet", () => {
    const { ctx, onClose } = renderDetails({ ...barvanje, ...all });
    fireEvent.click(button("Prestavi") as HTMLElement);
    fireEvent.click(button("ali izberite čas na koledarju") as HTMLElement);
    expect(ctx.moveMode.start).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 101 }));
    expect(onClose).toHaveBeenCalled();
  });

  it("a WORKER's own booking: the panel works", async () => {
    const moveTo = vi.fn().mockResolvedValue({ kind: "done", data: {} });
    renderDetails(
      { ...barvanje, ...all, mayReenter: false, mayNoShow: false },
      { moveMode: moveModeState({ moveTo }) }
    );
    fireEvent.click(button("Prestavi") as HTMLElement);
    fireEvent.change(screen.getByLabelText("Čas"), { target: { value: "15:30" } });
    fireEvent.click(button("Potrdi prestavitev") as HTMLElement);
    await waitFor(() =>
      expect(moveTo).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 101 }), at("15:30"), {
        fieldCodes: ["in_past"],
      })
    );
  });

  it("„Prestavi k drugemu delavcu“ opens the booking sheet pre-filled from this booking", () => {
    const { ctx, onClose } = renderDetails({ ...barvanje, ...all });
    fireEvent.click(button("Prestavi k drugemu delavcu") as HTMLElement);
    expect(ctx.setReenterFrom).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 101 }));
    expect(onClose).toHaveBeenCalled();
  });

  it("no-show marks and undoes with the actor", async () => {
    deskTrpc.noShow.mockResolvedValue({ status: "updated", noShow: true });
    renderDetails({ ...barvanje, ...all });
    fireEvent.click(button("Označi neprihod") as HTMLElement);
    await waitFor(() =>
      expect(deskTrpc.noShow).toHaveBeenCalledWith({ bookingId: 101, noShow: true, actorMemberId: OLGA })
    );
  });

  it("a marked no-show offers the undo", async () => {
    deskTrpc.noShow.mockResolvedValue({ status: "updated", noShow: false });
    renderDetails({ ...barvanje, ...all, noShow: true });
    expect(button("Označi neprihod")).toBeNull();
    // the badge keeps the noun key (flowko_desk_no_show_mark); the button has its own action key
    expect(screen.getByText("Neprihod")).toBeInTheDocument();
    fireEvent.click(button("Prekliči neprihod") as HTMLElement);
    await waitFor(() =>
      expect(deskTrpc.noShow).toHaveBeenCalledWith({ bookingId: 101, noShow: false, actorMemberId: OLGA })
    );
  });

  it("cancel asks for an optional reason and sends it with the actor", async () => {
    deskTrpc.cancel.mockResolvedValue({ status: "cancelled" });
    const { onClose } = renderDetails({ ...barvanje, ...all });
    fireEvent.click(button("Odpovej termin") as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Odpovej termin" });
    fireEvent.change(within(dialog).getByLabelText("Razlog (neobvezno)"), { target: { value: " Bolezen " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Odpovej termin" }));
    await waitFor(() =>
      expect(deskTrpc.cancel).toHaveBeenCalledWith({ bookingId: 101, reason: "Bolezen", actorMemberId: OLGA })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith("Termin je odpovedan.", "success");
  });

  it("cancel without a reason sends none", async () => {
    deskTrpc.cancel.mockResolvedValue({ status: "cancelled" });
    renderDetails({ ...barvanje, ...all });
    fireEvent.click(button("Odpovej termin") as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Odpovej termin" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Odpovej termin" }));
    await waitFor(() =>
      expect(deskTrpc.cancel).toHaveBeenCalledWith({ bookingId: 101, reason: null, actorMemberId: OLGA })
    );
  });
});
