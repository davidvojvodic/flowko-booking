// Flowko U28: the booking sheet (R10, R12, R13): create with worker + start from the tap, services in tap order,
// lookup, free-start chips, the override dialog after a refetch, field errors, and re-enter with another worker
// (create first, then cancel the old booking with „Prestavljeno k: {{name}}“).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeskBooking } from "@calcom/features/flowkoBusiness/desk";

import { BookingSheet } from "./BookingSheet";
import type { BookingSheetTarget } from "./BookingSheet";
import { ANA, BOR, DATE, OLGA, at, barvanje, iso, localeT } from "./desk.fixture";
import {
  DeskTestProvider,
  actorState,
  contextValue,
  deskTrpc,
  resetDeskTrpc,
  trpcError,
} from "./desk.testDoubles";

vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));
const toast = vi.fn();
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => toast(...args) }));

const marija = { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" };
const log: string[] = [];

function renderSheet(target: BookingSheetTarget, over: Parameters<typeof contextValue>[0] = {}) {
  const ctx = contextValue({
    refetch: vi.fn(async () => {
      log.push("refetch");
    }),
    ...over,
  });
  const onClose = vi.fn();
  render(
    <DeskTestProvider value={ctx}>
      <BookingSheet target={target} onClose={onClose} />
    </DeskTestProvider>
  );
  return { ctx, onClose };
}

const createAtBor = (hm = "13:30"): BookingSheetTarget => ({ kind: "create", memberId: BOR, start: at(hm) });
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const chip = (name: string) => screen.getByRole("button", { name });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Shrani" }));

function fillCustomer(name = "Marija Novak", phone = "041 123 456") {
  fireEvent.change(field("Ime in priimek"), { target: { value: name } });
  fireEvent.change(field("Telefon"), { target: { value: phone } });
}

describe("BookingSheet create (U28 R10, R13)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    toast.mockReset();
    log.length = 0;
  });

  it("pre-fills worker and time; offers only that worker's services; sends services in tap order", async () => {
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 9, uid: "u" });
    const { ctx, onClose } = renderSheet(createAtBor());
    expect(screen.getByTestId("desk-sheet-worker").textContent).toContain("Bor");
    expect(field("Datum").value).toBe(DATE);
    expect(field("Čas").value).toBe("13:30");
    expect(screen.queryByRole("button", { name: "Barvanje" })).toBeNull();
    fireEvent.click(chip("Fen"));
    fireEvent.click(chip("Moško striženje"));
    expect(chip("Fen")).toHaveAttribute("aria-pressed", "true");
    fillCustomer();
    save();
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalled());
    expect(deskTrpc.create).toHaveBeenCalledWith({
      workerMemberId: BOR,
      serviceIds: [3, 2],
      start: iso("13:30"),
      customer: { name: "Marija Novak", phone: "041 123 456", email: null },
      confirmOverride: false,
      actorMemberId: OLGA,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(ctx.invalidate).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Termin je shranjen.", "success");
  });

  it("tapping a chosen service again takes it out", () => {
    renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fireEvent.click(chip("Fen"));
    expect(chip("Fen")).toHaveAttribute("aria-pressed", "false");
  });

  it("refuses to send without services, customer name or contact", async () => {
    renderSheet(createAtBor());
    save();
    expect(await screen.findByText("Izberite vsaj eno storitev.")).toBeInTheDocument();
    expect(screen.getByText("Vpišite ime stranke.")).toBeInTheDocument();
    expect(screen.getByText("Vpišite telefon ali e-pošto.")).toBeInTheDocument();
    expect(deskTrpc.create).not.toHaveBeenCalled();
  });

  it("a lookup result fills name, phone and e-mail; „Nova stranka“ clears them", async () => {
    deskTrpc.customersQuery.mockReturnValue({ data: [marija], isFetching: false });
    renderSheet(createAtBor());
    fireEvent.change(field("Ime ali telefon"), { target: { value: "Mar" } });
    fireEvent.click(await screen.findByRole("button", { name: /Marija Novak/ }, { timeout: 2000 }));
    expect(field("Ime in priimek").value).toBe("Marija Novak");
    expect(field("Telefon").value).toBe("+38641123456");
    expect(field("E-pošta").value).toBe("marija@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    expect(field("Ime in priimek").value).toBe("");
    expect(field("Telefon").value).toBe("");
    expect(field("E-pošta").value).toBe("");
  });

  it("a free-start chip of the chosen worker sets the time", async () => {
    deskTrpc.freeStartsQuery.mockReturnValue({
      data: {
        workers: [
          { memberId: ANA, displayName: "Ana", starts: [iso("10:40")], googleUnavailable: false },
          {
            memberId: BOR,
            displayName: "Bor",
            starts: [iso("13:30"), iso("14:00")],
            googleUnavailable: false,
          },
        ],
      },
      isFetching: false,
    });
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 9, uid: "u" });
    renderSheet(createAtBor());
    fireEvent.click(chip("Moško striženje"));
    expect(deskTrpc.freeStartsQuery).toHaveBeenLastCalledWith(
      { date: DATE, serviceIds: [2] },
      expect.objectContaining({ enabled: true })
    );
    fireEvent.click(chip("14:00"));
    expect(field("Čas").value).toBe("14:00");
    fillCustomer();
    save();
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalled());
    expect(deskTrpc.create.mock.calls[0][0]).toMatchObject({ start: iso("14:00") });
  });

  it("needs_confirm: the day is refetched before the dialog shows; „Vseeno shrani“ resends with confirmOverride", async () => {
    let release: () => void = () => undefined;
    const refetch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          log.push("refetch");
          release = resolve;
        })
    );
    deskTrpc.create
      .mockResolvedValueOnce({
        status: "needs_confirm",
        problems: [
          { kind: "overlaps_booking", step: 0, with: { start: at("13:00"), end: at("13:30") } },
          { kind: "outside_shift", step: 1 },
        ],
        googleUnavailable: false,
      })
      .mockResolvedValueOnce({ status: "created", bookingId: 9, uid: "u" });
    const { onClose } = renderSheet(createAtBor("13:15"), { refetch });
    fireEvent.click(chip("Fen"));
    fireEvent.click(chip("Moško striženje"));
    fillCustomer();
    save();
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(screen.queryByText("Termin ni v skladu s pravili")).toBeNull();
    await act(async () => release());
    const dialog = await screen.findByRole("dialog", { name: "Termin ni v skladu s pravili" });
    expect(
      within(dialog)
        .getAllByTestId("desk-problem")
        .map((l) => l.textContent)
    ).toEqual(["Fen: prekriva se s terminom 13:00–13:30.", "Moško striženje: zunaj izmene delavca."]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Vseeno shrani" }));
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalledTimes(2));
    expect(deskTrpc.create.mock.calls[1][0]).toMatchObject({ confirmOverride: true, serviceIds: [3, 2] });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("while „Vseeno shrani“ resends, Save is disabled and a second Save sends nothing", async () => {
    let finish: (v: unknown) => void = () => undefined;
    deskTrpc.create
      .mockResolvedValueOnce({
        status: "needs_confirm",
        problems: [{ kind: "outside_shift", step: 0 }],
        googleUnavailable: false,
      })
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { onClose } = renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fillCustomer();
    save();
    const dialog = await screen.findByRole("dialog", { name: "Termin ni v skladu s pravili" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Vseeno shrani" }));
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalledTimes(2));
    expect(deskTrpc.create.mock.calls[1][0]).toMatchObject({ confirmOverride: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Shrani" })).toBeDisabled());
    save();
    await act(async () => undefined);
    expect(deskTrpc.create).toHaveBeenCalledTimes(2);
    await act(async () => finish({ status: "created", bookingId: 9, uid: "u" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deskTrpc.create).toHaveBeenCalledTimes(2);
  });

  it("googleUnavailable shows the Google line instead of the calendar overlap", async () => {
    deskTrpc.create.mockResolvedValue({
      status: "needs_confirm",
      problems: [{ kind: "overlaps_external", step: 0, with: { start: at("00:00"), end: at("23:00") } }],
      googleUnavailable: true,
    });
    renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fillCustomer();
    save();
    const dialog = await screen.findByRole("dialog", { name: "Termin ni v skladu s pravili" });
    expect(
      within(dialog)
        .getAllByTestId("desk-problem")
        .map((l) => l.textContent)
    ).toEqual(["Google koledar trenutno ni dosegljiv"]);
  });

  it("in_past is a field error on the time, with no dialog and no toast", async () => {
    deskTrpc.create.mockRejectedValue(trpcError("in_past"));
    const { ctx } = renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fillCustomer();
    save();
    expect(await screen.findByText("Termin je v preteklosti. Izberite poznejši čas.")).toBeInTheDocument();
    expect(ctx.refetch).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Termin ni v skladu s pravili" })).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("bad_customer is a customer field error", async () => {
    deskTrpc.create.mockRejectedValue(trpcError("bad_customer"));
    renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fillCustomer("Marija", "123");
    save();
    expect(
      await screen.findByText("Preverite stranko: ime ter veljaven telefon ali e-pošto.")
    ).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });

  it("other codes show their toast and keep the sheet open", async () => {
    deskTrpc.create.mockRejectedValue(trpcError("duplicate_time"));
    const { onClose } = renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fillCustomer();
    save();
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Ta termin je bil pravkar že shranjen.", "error"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("with nobody chosen at the desk, save opens the picker and sends nothing", async () => {
    const actor = actorState({ actor: null, needsChoice: true });
    renderSheet(createAtBor(), { actor });
    fireEvent.click(chip("Fen"));
    fillCustomer();
    save();
    await waitFor(() => expect(actor.openPicker).toHaveBeenCalled());
    expect(deskTrpc.create).not.toHaveBeenCalled();
  });
});

describe("BookingSheet re-enter with another worker (U28 R12)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    toast.mockReset();
    log.length = 0;
  });

  const reenter = (booking: DeskBooking = barvanje): BookingSheetTarget => ({ kind: "reenter", booking });

  it("pre-fills services and customer, excludes the booking's own worker, creates first and then cancels", async () => {
    deskTrpc.create.mockImplementation(async () => {
      log.push("create");
      return { status: "created", bookingId: 9, uid: "u" };
    });
    deskTrpc.cancel.mockImplementation(async () => {
      log.push("cancel");
      return { status: "cancelled" };
    });
    const { onClose } = renderSheet(reenter());
    const select = screen.getByLabelText("Delavec") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(["Izberite delavca", "Olga", "Bor", "Cene"]);
    expect(chip("Barvanje")).toHaveAttribute("aria-pressed", "true");
    expect(field("Ime in priimek").value).toBe("Marija Novak");
    expect(field("Čas").value).toBe("09:00");
    fireEvent.change(select, { target: { value: String(OLGA) } });
    save();
    await waitFor(() => expect(deskTrpc.cancel).toHaveBeenCalled());
    expect(log).toEqual(["create", "cancel"]);
    expect(deskTrpc.create).toHaveBeenCalledWith({
      workerMemberId: OLGA,
      serviceIds: [1],
      start: iso("09:00"),
      customer: { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" },
      confirmOverride: false,
      actorMemberId: OLGA,
    });
    expect(deskTrpc.cancel).toHaveBeenCalledWith({
      bookingId: 101,
      reason: "Prestavljeno k: Olga",
      actorMemberId: OLGA,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith("Termin je prestavljen k: Olga", "success");
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("keeps the old services in their order", async () => {
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 9, uid: "u" });
    deskTrpc.cancel.mockResolvedValue({ status: "cancelled" });
    renderSheet(reenter({ ...barvanje, serviceIds: [2, 1], memberId: BOR }));
    fireEvent.change(screen.getByLabelText("Delavec"), { target: { value: String(ANA) } });
    save();
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalled());
    expect(deskTrpc.create.mock.calls[0][0]).toMatchObject({ workerMemberId: ANA, serviceIds: [2, 1] });
  });

  it("asks for a worker first", async () => {
    renderSheet(reenter());
    save();
    expect(await screen.findByText("Izberite delavca.")).toBeInTheDocument();
    expect(deskTrpc.create).not.toHaveBeenCalled();
  });

  it("a failing cancel says both bookings exist", async () => {
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 9, uid: "u" });
    deskTrpc.cancel.mockRejectedValue(trpcError("booking_not_active"));
    const { onClose } = renderSheet(reenter());
    fireEvent.change(screen.getByLabelText("Delavec"), { target: { value: String(BOR) } });
    save();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Nov termin pri: Bor je shranjen, starega pa ni bilo mogoče odpovedati. Zdaj obstajata oba; starega odpovejte ročno.",
        "warning"
      )
    );
    expect(toast).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("a booking whose service was deleted starts with no services and says so", () => {
    renderSheet(reenter({ ...barvanje, serviceIds: null }));
    expect(
      screen.getByText("Storitev tega termina ne obstaja več. Storitve izberite znova.")
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Delavec"), { target: { value: String(OLGA) } });
    expect(chip("Barvanje")).toHaveAttribute("aria-pressed", "false");
  });

  it("a refused create cancels nothing", async () => {
    deskTrpc.create.mockRejectedValue(trpcError("worker_locked"));
    renderSheet(reenter());
    fireEvent.change(screen.getByLabelText("Delavec"), { target: { value: String(BOR) } });
    save();
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Ta delavec je zaklenjen.", "error"));
    expect(deskTrpc.cancel).not.toHaveBeenCalled();
  });
});
