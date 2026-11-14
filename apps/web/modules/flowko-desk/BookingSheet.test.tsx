// Flowko U28: the booking sheet (R10, R12, R13): create with worker + start from the tap, services in tap order,
// lookup, free-start chips, the override dialog after a refetch, field errors, and re-enter with another worker
// (create first, then cancel the old booking with „Prestavljeno k: {{name}}“). U28b B2: the customer section
// shows the search first, „Nova stranka“ fields on demand, a picked customer as a card.
// Flowko U29e: chips carry the price (E8, „Barvanje · 45,00 €“) with a total; the services list says loading / error
// apart from „none“ (E10.4); the re-enter cancel sends the hand-over marker and the reason with the name once.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeskBooking } from "@calcom/features/flowkoBusiness/desk";

import { BookingSheet } from "./BookingSheet";
import type { BookingSheetTarget } from "./BookingSheet";
import { ANA, BOR, DATE, OLGA, at, barvanje, deskView, iso, localeT, services } from "./desk.fixture";
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
// Flowko U29e (E8): a chip's name is the service, then „ · price“ when it has one.
const chipName = (name: string) => new RegExp(`^${name}( · .*)?$`);
const chip = (name: string) => screen.getByRole("button", { name: chipName(name) });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Shrani" }));
const saveButton = () => screen.getByRole("button", { name: "Shrani" });

// Flowko U28b (B2): the new-customer fields appear only after „Nova stranka“.
function fillCustomer(name = "Marija Novak", phone = "041 123 456") {
  fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
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
    expect(screen.queryByRole("button", { name: chipName("Barvanje") })).toBeNull();
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

  it("with a customer but no service, Save says to choose a service", async () => {
    renderSheet(createAtBor());
    fillCustomer();
    save();
    expect(await screen.findByText("Izberite vsaj eno storitev.")).toBeInTheDocument();
    expect(deskTrpc.create).not.toHaveBeenCalled();
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
    ).toEqual(["Fen: prekriva se s terminom 13:00–13:30.", "Moško striženje: zunaj izmene."]);
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
    ).toEqual(["Google koledar trenutno ni dosegljiv."]);
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
      await screen.findByText("Preverite podatke stranke: ime ter veljavna telefonska številka ali e-pošta.")
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

  it("with the actor not known yet, save sends nothing and opens no picker (U28b B1)", async () => {
    const actor = actorState({ actor: null });
    renderSheet(createAtBor(), { actor });
    fireEvent.click(chip("Fen"));
    fillCustomer();
    save();
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Koledarja ni bilo mogoče naložiti.", "error"));
    expect(actor.openPicker).not.toHaveBeenCalled();
    expect(deskTrpc.create).not.toHaveBeenCalled();
  });
});

// Flowko U28b (B2): the customer section shows the search first; „Nova stranka“ reveals the fields (pre-filled from
// the typed text); a picked customer is a card with „Zamenjaj“; Save waits for a customer.
describe("BookingSheet customer section (U28b B2)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    toast.mockReset();
    log.length = 0;
  });

  const customerFields = () =>
    ["Ime in priimek", "Telefon", "E-pošta"].map((l) => screen.queryByLabelText(l));

  it("starts with only the search and „Nova stranka“; Save is disabled", () => {
    renderSheet(createAtBor());
    expect(field("Ime ali telefon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova stranka" })).toBeInTheDocument();
    expect(customerFields()).toEqual([null, null, null]);
    expect(screen.queryByTestId("desk-customer-card")).toBeNull();
    fireEvent.click(chip("Fen"));
    expect(saveButton()).toBeDisabled();
  });

  it("a picked result is a card (name, phone, e-mail) and is what Save sends", async () => {
    deskTrpc.customersQuery.mockReturnValue({ data: [marija], isFetching: false });
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 9, uid: "u" });
    renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fireEvent.change(field("Ime ali telefon"), { target: { value: "Mar" } });
    fireEvent.click(await screen.findByRole("button", { name: /Marija Novak/ }, { timeout: 2000 }));
    const card = screen.getByTestId("desk-customer-card");
    expect(card.textContent).toContain("Marija Novak");
    expect(card.textContent).toContain("+38641123456");
    expect(card.textContent).toContain("marija@example.com");
    expect(screen.queryByLabelText("Ime ali telefon")).toBeNull();
    expect(customerFields()).toEqual([null, null, null]);
    expect(saveButton()).not.toBeDisabled();
    save();
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalled());
    expect(deskTrpc.create).toHaveBeenCalledWith({
      workerMemberId: BOR,
      serviceIds: [3],
      start: iso("13:30"),
      customer: { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" },
      confirmOverride: false,
      actorMemberId: OLGA,
    });
  });

  it("„Zamenjaj“ goes back to the search and Save waits again", async () => {
    deskTrpc.customersQuery.mockReturnValue({ data: [marija], isFetching: false });
    renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fireEvent.change(field("Ime ali telefon"), { target: { value: "Mar" } });
    fireEvent.click(await screen.findByRole("button", { name: /Marija Novak/ }, { timeout: 2000 }));
    fireEvent.click(screen.getByRole("button", { name: "Zamenjaj" }));
    expect(screen.queryByTestId("desk-customer-card")).toBeNull();
    expect(field("Ime ali telefon").value).toBe("");
    expect(customerFields()).toEqual([null, null, null]);
    expect(saveButton()).toBeDisabled();
  });

  it("„Nova stranka“ after typed letters pre-fills the name; Save waits for a phone or an e-mail", async () => {
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 9, uid: "u" });
    renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fireEvent.change(field("Ime ali telefon"), { target: { value: "Marija Novak" } });
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    expect(field("Ime in priimek").value).toBe("Marija Novak");
    expect(field("Telefon").value).toBe("");
    expect(field("E-pošta").value).toBe("");
    expect(saveButton()).toBeDisabled();
    fireEvent.change(field("E-pošta"), { target: { value: "marija@example.com" } });
    expect(saveButton()).not.toBeDisabled();
    save();
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalled());
    expect(deskTrpc.create.mock.calls[0][0]).toMatchObject({
      customer: { name: "Marija Novak", phone: null, email: "marija@example.com" },
    });
  });

  it("„Nova stranka“ after a typed number pre-fills the phone; Save waits for the name", () => {
    renderSheet(createAtBor());
    fireEvent.change(field("Ime ali telefon"), { target: { value: "041 123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    expect(field("Ime in priimek").value).toBe("");
    expect(field("Telefon").value).toBe("041 123 456");
    expect(saveButton()).toBeDisabled();
    fireEvent.change(field("Ime in priimek"), { target: { value: "   " } });
    expect(saveButton()).toBeDisabled();
    fireEvent.change(field("Ime in priimek"), { target: { value: "Marija" } });
    expect(saveButton()).not.toBeDisabled();
  });

  it("a result picked while the new-customer fields are open replaces them with the card", async () => {
    deskTrpc.customersQuery.mockReturnValue({ data: [marija], isFetching: false });
    renderSheet(createAtBor());
    fillCustomer("Nekdo", "040 000 000");
    fireEvent.change(field("Ime ali telefon"), { target: { value: "Mar" } });
    fireEvent.click(await screen.findByRole("button", { name: /Marija Novak/ }, { timeout: 2000 }));
    expect(screen.getByTestId("desk-customer-card").textContent).toContain("Marija Novak");
    expect(customerFields()).toEqual([null, null, null]);
  });

  // Flowko U28b review fixes: a second „Nova stranka“ merges into what is typed, never blanks it.
  it("a second „Nova stranka“ with an empty search keeps what was typed", () => {
    renderSheet(createAtBor());
    fillCustomer("Marija Novak", "041 123 456");
    fireEvent.change(field("E-pošta"), { target: { value: "marija@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    expect(field("Ime in priimek").value).toBe("Marija Novak");
    expect(field("Telefon").value).toBe("041 123 456");
    expect(field("E-pošta").value).toBe("marija@example.com");
  });

  it("a phone typed in the search and „Nova stranka“ again fills the phone and keeps the name", () => {
    renderSheet(createAtBor());
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    fireEvent.change(field("Ime in priimek"), { target: { value: "Marija Novak" } });
    fireEvent.change(field("Ime ali telefon"), { target: { value: "041 123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    expect(field("Ime in priimek").value).toBe("Marija Novak");
    expect(field("Telefon").value).toBe("041 123 456");
  });

  it("the new-customer fields say what is missing while Save is disabled", () => {
    renderSheet(createAtBor());
    fireEvent.click(chip("Fen"));
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    fireEvent.change(field("Ime in priimek"), { target: { value: "Marija" } });
    const hint = screen.getByText("Vpišite telefon ali e-pošto.");
    expect(hint).not.toHaveAttribute("role", "alert");
    expect(screen.queryByText("Vpišite ime stranke.")).toBeNull();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(field("Telefon"), { target: { value: "041 123 456" } });
    expect(screen.queryByText("Vpišite telefon ali e-pošto.")).toBeNull();
    expect(saveButton()).not.toBeDisabled();
    fireEvent.change(field("Ime in priimek"), { target: { value: "" } });
    expect(screen.getByText("Vpišite ime stranke.")).not.toHaveAttribute("role", "alert");
    expect(saveButton()).toBeDisabled();
  });

  it("a picked result that the customer rules refuse opens the editable fields, not the card", async () => {
    deskTrpc.customersQuery.mockReturnValue({
      data: [{ name: "Brez kontakta", phone: null, email: null }],
      isFetching: false,
    });
    renderSheet(createAtBor());
    fireEvent.change(field("Ime ali telefon"), { target: { value: "Brez" } });
    fireEvent.click(await screen.findByRole("button", { name: /Brez kontakta/ }, { timeout: 2000 }));
    expect(screen.queryByTestId("desk-customer-card")).toBeNull();
    expect(field("Ime in priimek").value).toBe("Brez kontakta");
    expect(saveButton()).toBeDisabled();
  });

  // Focus follows the customer section's state changes.
  it("„Nova stranka“ focuses the first empty field", () => {
    renderSheet(createAtBor());
    fireEvent.change(field("Ime ali telefon"), { target: { value: "Marija" } });
    fireEvent.click(screen.getByRole("button", { name: "Nova stranka" }));
    expect(document.activeElement).toBe(field("Telefon"));
  });

  it("a picked result focuses „Zamenjaj“; „Zamenjaj“ focuses the search", async () => {
    deskTrpc.customersQuery.mockReturnValue({ data: [marija], isFetching: false });
    renderSheet(createAtBor());
    fireEvent.change(field("Ime ali telefon"), { target: { value: "Mar" } });
    fireEvent.click(await screen.findByRole("button", { name: /Marija Novak/ }, { timeout: 2000 }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Zamenjaj" }));
    fireEvent.click(screen.getByRole("button", { name: "Zamenjaj" }));
    expect(document.activeElement).toBe(field("Ime ali telefon"));
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
    // Flowko U28b (B2): the old booking's customer is the card; no search, no fields.
    expect(screen.getByTestId("desk-customer-card").textContent).toContain("Marija Novak");
    expect(screen.queryByLabelText("Ime in priimek")).toBeNull();
    expect(screen.queryByLabelText("Ime ali telefon")).toBeNull();
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
    // Flowko U29e (E6, R10): the hand-over marker names the new worker; the reason text stays.
    expect(deskTrpc.cancel).toHaveBeenCalledWith({
      bookingId: 101,
      reason: "Prestavljeno k: Olga",
      actorMemberId: OLGA,
      handoverToMemberId: OLGA,
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
        "Nov termin (Bor) je shranjen, starega pa ni bilo mogoče odpovedati. Zdaj obstajata oba termina; starega odpovejte ročno.",
        "warning"
      )
    );
    expect(toast).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("a booking whose service was deleted starts with no services and says so", () => {
    renderSheet(reenter({ ...barvanje, serviceIds: null }));
    expect(
      screen.getByText("Ena od storitev tega termina ne obstaja več. Storitve izberite znova.")
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Delavec"), { target: { value: String(OLGA) } });
    expect(chip("Barvanje")).toHaveAttribute("aria-pressed", "false");
  });

  // Flowko U28b review fixes: a carded customer the rules refuse stays editable.
  it("re-enter with an 81-character name opens the editable fields, not the card", () => {
    const longName = "M".repeat(81);
    renderSheet(reenter({ ...barvanje, customer: { ...barvanje.customer, name: longName } }));
    expect(screen.queryByTestId("desk-customer-card")).toBeNull();
    expect(field("Ime in priimek").value).toBe(longName);
    expect(field("Telefon").value).toBe("+38641123456");
    expect(saveButton()).toBeDisabled();
  });

  it("a server bad_customer for the carded customer opens the fields with the error", async () => {
    deskTrpc.create.mockRejectedValue(trpcError("bad_customer"));
    renderSheet(reenter());
    fireEvent.change(screen.getByLabelText("Delavec"), { target: { value: String(BOR) } });
    save();
    expect(
      await screen.findByText("Preverite podatke stranke: ime ter veljavna telefonska številka ali e-pošta.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("desk-customer-card")).toBeNull();
    expect(field("Ime in priimek").value).toBe("Marija Novak");
    expect(field("Telefon").value).toBe("+38641123456");
    expect(deskTrpc.cancel).not.toHaveBeenCalled();
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

// Flowko U29e: E8, R16 — the price on the chips and the total while booking.
describe("BookingSheet prices (U29e E8)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    toast.mockReset();
  });

  const createAtAna = (): BookingSheetTarget => ({ kind: "create", memberId: ANA, start: at("11:00") });
  const total = () => screen.queryByTestId("desk-price-total");
  const partial = () => screen.queryByText("Cena ni znana za vse izbrane storitve.");

  it("chips show „Name · price“; an unpriced service shows its name only", () => {
    renderSheet(createAtAna());
    expect(screen.getByRole("button", { name: /^Barvanje · 45,00\u00a0€$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Moško striženje · 20,00\u00a0€$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fen" })).toBeInTheDocument();
    const price = screen
      .getByRole("button", { name: /^Barvanje/ })
      .querySelector("[data-testid='desk-chip-price']");
    expect(price?.className).toContain("tabular-nums");
    expect(total()).toBeNull();
  });

  // Flowko U29e final review UI-4: name and price share one inline span, so the space before „·“
  // is not dropped at a flex item's start (jsdom has no layout; the shared parent is the proof).
  it("a chip's name and price sit in one span", () => {
    renderSheet(createAtAna());
    const price = within(chip("Barvanje")).getByTestId("desk-chip-price");
    expect(price.parentElement?.textContent).toBe(`Barvanje · 45,00${String.fromCharCode(160)}€`);
  });

  it("Barvanje + Moško striženje: „Skupaj: 65,00 €“, no note", () => {
    renderSheet(createAtAna());
    fireEvent.click(chip("Barvanje"));
    fireEvent.click(chip("Moško striženje"));
    expect(total()?.textContent).toBe("Skupaj: 65,00\u00a0€");
    expect(partial()).toBeNull();
  });

  it("Barvanje + Fen: the total of the priced one and the note", () => {
    renderSheet(createAtAna());
    fireEvent.click(chip("Barvanje"));
    fireEvent.click(chip("Fen"));
    expect(total()?.textContent).toBe("Skupaj: 45,00\u00a0€");
    expect(partial()).toBeInTheDocument();
  });

  it("only Fen: no total line, no note", () => {
    renderSheet(createAtAna());
    fireEvent.click(chip("Fen"));
    expect(total()).toBeNull();
    expect(partial()).toBeNull();
  });

  it("a price of 0 counts: „Skupaj: 0,00 €“", () => {
    deskTrpc.servicesQuery.mockReturnValue({
      data: services.map((s) => (s.id === 3 ? { ...s, priceCents: 0 } : s)),
    });
    renderSheet(createAtAna());
    fireEvent.click(chip("Fen"));
    expect(total()?.textContent).toBe("Skupaj: 0,00\u00a0€");
  });

  it("re-enter shows the prices too, with the total of the old services", () => {
    renderSheet({ kind: "reenter", booking: barvanje });
    expect(screen.getByRole("button", { name: /^Barvanje · 45,00\u00a0€$/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(total()?.textContent).toBe("Skupaj: 45,00\u00a0€");
  });

  it("the payload never carries a price", async () => {
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 9, uid: "u" });
    renderSheet(createAtAna());
    fireEvent.click(chip("Barvanje"));
    fillCustomer();
    save();
    await waitFor(() => expect(deskTrpc.create).toHaveBeenCalled());
    expect(JSON.stringify(deskTrpc.create.mock.calls[0][0])).not.toMatch(/price|4500|45,00/i);
  });
});

// Flowko U29e: E10.4, R20 — „no services“ only once the list is known; loading and error say so.
describe("BookingSheet services loading (U29e E10.4)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    toast.mockReset();
  });

  const none = () => screen.queryByText("Tej osebi ni dodeljena nobena storitev.");

  it("while loading: no „none“ line, a busy skeleton", () => {
    deskTrpc.servicesQuery.mockReturnValue({ data: undefined, error: null, refetch: vi.fn() });
    renderSheet(createAtBor());
    expect(none()).toBeNull();
    const chips = screen.getByTestId("desk-sheet-services");
    expect(chips).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("desk-services-loading")).toBeInTheDocument();
    expect(screen.queryByText("Storitev ni bilo mogoče naložiti.")).toBeNull();
  });

  it("an empty list says „none“, not busy", () => {
    deskTrpc.servicesQuery.mockReturnValue({ data: [], error: null, refetch: vi.fn() });
    renderSheet(createAtBor());
    expect(none()).toBeInTheDocument();
    expect(screen.getByTestId("desk-sheet-services")).not.toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("desk-services-loading")).toBeNull();
  });

  it("a worker without services says „none“", () => {
    deskTrpc.servicesQuery.mockReturnValue({
      data: services.map((s) => ({ ...s, workerMemberIds: s.workerMemberIds.filter((id) => id !== BOR) })),
    });
    renderSheet(createAtBor());
    expect(none()).toBeInTheDocument();
  });

  it("an error: the load-error text and „Poskusi znova“ refetches; no „none“ line", () => {
    const refetch = vi.fn();
    deskTrpc.servicesQuery.mockReturnValue({ data: undefined, error: new Error("boom"), refetch });
    renderSheet(createAtBor());
    expect(none()).toBeNull();
    expect(screen.getByText("Storitev ni bilo mogoče naložiti.")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-services-loading")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("an error after an earlier answer keeps the chips (stale data wins)", () => {
    deskTrpc.servicesQuery.mockReturnValue({ data: services, error: new Error("boom"), refetch: vi.fn() });
    renderSheet(createAtBor());
    expect(chip("Fen")).toBeInTheDocument();
    expect(screen.queryByText("Storitev ni bilo mogoče naložiti.")).toBeNull();
  });
});

// Flowko U29e: E10.1, R10 — a worker „Bor & Co“: the stored reason and both toasts carry „&“ once.
describe("BookingSheet re-enter names once (U29e E10.1)", () => {
  beforeEach(() => {
    resetDeskTrpc();
    toast.mockReset();
  });

  const borAndCo = () => {
    const view = deskView();
    view.days[0].columns = view.days[0].columns.map((c) =>
      c.memberId === BOR ? { ...c, displayName: "Bor & Co" } : c
    );
    return view;
  };

  it("success: reason „Prestavljeno k: Bor & Co“, marker BOR, toast with „&“ once", async () => {
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 9, uid: "u" });
    deskTrpc.cancel.mockResolvedValue({ status: "cancelled" });
    renderSheet({ kind: "reenter", booking: barvanje }, { view: borAndCo() });
    fireEvent.change(screen.getByLabelText("Delavec"), { target: { value: String(BOR) } });
    save();
    await waitFor(() => expect(deskTrpc.cancel).toHaveBeenCalled());
    expect(deskTrpc.cancel).toHaveBeenCalledWith({
      bookingId: 101,
      reason: "Prestavljeno k: Bor & Co",
      actorMemberId: OLGA,
      handoverToMemberId: BOR,
    });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Termin je prestavljen k: Bor & Co", "success"));
  });

  it("a failed cancel: the warning names „Bor & Co“ once", async () => {
    deskTrpc.create.mockResolvedValue({ status: "created", bookingId: 9, uid: "u" });
    deskTrpc.cancel.mockRejectedValue(trpcError("booking_not_active"));
    renderSheet({ kind: "reenter", booking: barvanje }, { view: borAndCo() });
    fireEvent.change(screen.getByLabelText("Delavec"), { target: { value: String(BOR) } });
    save();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("(Bor & Co)"), "warning"));
  });
});
