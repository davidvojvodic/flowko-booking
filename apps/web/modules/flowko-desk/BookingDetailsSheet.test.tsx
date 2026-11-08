// Flowko U28: the booking details sheet (R5, R12, D4): what the booking is, its history („who did what“), and the
// actions its flags allow: move (tap mode or date + time), move to another worker, no-show and its undo, cancel
// with an optional reason. Every write carries the actor.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeskBooking } from "@calcom/features/flowkoBusiness/desk";

import { BookingDetailsSheet, historyLines } from "./BookingDetailsSheet";
import { OLGA, TZ, at, barvanje, iso, localeT } from "./desk.fixture";
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
      "Ustvaril: Olga · 15. 11. 2026 11:00",
      "Shranjeno kljub opozorilom: prekrivanje s terminom, zunaj izmene",
      "Prestavil: Rok · iz 08:30 na 09:00 · 15. 11. 2026 13:00",
      "Prestavil: Rok · iz 17. 11. 08:30 na 16. 11. 09:00 · 15. 11. 2026 13:05",
      "Shranjeno kljub opozorilom: odsotnost",
      "Ni prišla/prišel: Olga · 16. 11. 2026 09:30",
      "Preklicano »ni prišla/prišel«: neznano · 16. 11. 2026 09:40",
      "Odpovedal: Ana · 16. 11. 2026 10:00",
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
      "Ustvaril: Olga · 15. 11. 2026 11:00",
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
    expect(screen.queryAllByRole("button", { name: /Prestavi|Odpovej|prišla|neprihod/i })).toEqual([]);
    expect(screen.queryByLabelText("Čas")).toBeNull();
  });

  it("„Prestavi“ enters move mode and closes the sheet", () => {
    const { ctx, onClose } = renderDetails({ ...barvanje, ...all });
    fireEvent.click(button("Prestavi") as HTMLElement);
    expect(ctx.moveMode.start).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 101 }));
    expect(onClose).toHaveBeenCalled();
  });

  it("the date + time field moves the booking; in_past shows under the field", async () => {
    const moveTo = vi
      .fn()
      .mockResolvedValue({ kind: "error", code: "in_past", message: "flowko_desk_error_in_past" });
    renderDetails({ ...barvanje, ...all }, { moveMode: moveModeState({ moveTo }) });
    expect((screen.getByLabelText("Datum") as HTMLInputElement).value).toBe("2026-11-16");
    expect((screen.getByLabelText("Čas") as HTMLInputElement).value).toBe("09:00");
    fireEvent.change(screen.getByLabelText("Datum"), { target: { value: "2026-11-19" } });
    fireEvent.change(screen.getByLabelText("Čas"), { target: { value: "12:00" } });
    fireEvent.click(button("Prestavi na izbrani čas") as HTMLElement);
    await waitFor(() =>
      expect(moveTo).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: 101 }),
        at("12:00", "2026-11-19"),
        {
          fieldCodes: ["in_past"],
        }
      )
    );
    expect(await screen.findByText("Termin je v preteklosti. Izberite poznejši čas.")).toBeInTheDocument();
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
    expect(screen.getByText("Ni prišla/prišel")).toBeInTheDocument();
    fireEvent.click(button("Prekliči »ni prišla/prišel«") as HTMLElement);
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
