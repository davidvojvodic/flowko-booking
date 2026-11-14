// Flowko U29a: the service sheet (S8–S12). New: empty name, one 30-minute working step, every ACTIVE column member
// ticked (LOCKED shown disabled, unticked). Edit: the stored values, a LOCKED member disabled with its current
// state and never sent. The save validates with serviceInputSchema (each code's text at its field, nothing sent on
// a refused value) and sends {id?, name, category, steps, workerMemberIds}; each server code has its text
// (service_name_taken at the name); the S11 note (plural) when future bookings use the service; „Odstrani“ opens
// the S12 dialog with the plural count and removes on confirm.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SERVICE_ERROR_CODES, ServiceSheet, type ServiceSheetTarget } from "./ServiceSheet";
import { ANA, BARVANJE, BOR, DAN, FEN, KVAR, localeT, MEMBERS, STRIZENJE } from "./settings.fixture";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
  onClose: vi.fn(),
  onChanged: vi.fn(),
  lang: { current: "sl" as "sl" | "en" },
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT(mocks.lang.current) }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      flowko: {
        services: {
          save: {
            useMutation: () => ({ mutateAsync: (input: unknown) => mocks.save(input), isPending: false }),
          },
          remove: {
            useMutation: () => ({ mutateAsync: (input: unknown) => mocks.remove(input), isPending: false }),
          },
        },
      },
    },
  },
}));

/** A TRPCClientError as the page sees it: `message` is the Flowko code, `data.code` the tRPC code. */
function trpcError(message: string, code = "BAD_REQUEST") {
  return Object.assign(new Error(message), { data: { code } });
}

beforeEach(() => {
  for (const fn of [mocks.save, mocks.remove, mocks.toast, mocks.onClose, mocks.onChanged]) fn.mockReset();
  mocks.lang.current = "sl";
  mocks.save.mockResolvedValue({ serviceId: 99 });
  mocks.remove.mockResolvedValue(undefined);
  mocks.onChanged.mockResolvedValue(undefined);
});

/** Flowko U29b: a promise the test settles by hand (the S17 refresh that is still running). */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function open(target: ServiceSheetTarget) {
  render(
    <ServiceSheet target={target} members={MEMBERS} onClose={mocks.onClose} onChanged={mocks.onChanged} />
  );
}
const edit = (service = BARVANJE): ServiceSheetTarget => ({ kind: "edit", service });

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => {
  fireEvent.change(input(label), { target: { value } });
};
const box = (name: string) => screen.getByRole("checkbox", { name });

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Shrani" }));
  });
}

describe("ServiceSheet: a new service", () => {
  it("starts empty with one 30-minute working step and every ACTIVE member ticked (LOCKED disabled)", () => {
    open({ kind: "new" });
    expect(screen.getByRole("heading", { name: "Nova storitev" })).toBeInTheDocument();
    expect(input("Ime storitve").value).toBe("");
    expect(input("Kategorija").value).toBe("");
    expect((screen.getByLabelText("1. korak: vrsta") as HTMLSelectElement).value).toBe("busy");
    expect(input("1. korak: minute").value).toBe("30");
    expect(screen.queryByLabelText("2. korak: vrsta")).toBeNull();
    expect(box("Ana")).toBeChecked();
    expect(box("Bor")).toBeChecked();
    expect(box("Dan (zaklenjeno)")).not.toBeChecked();
    expect(box("Dan (zaklenjeno)")).toBeDisabled();
  });

  it("has no „Odstrani“ and no future-bookings note", () => {
    open({ kind: "new" });
    expect(screen.queryByRole("button", { name: "Odstrani" })).toBeNull();
    expect(screen.queryByTestId("flowko-service-future-bookings")).toBeNull();
  });

  it("saves trimmed values without an id, an empty category as null, and the ticked ACTIVE members", async () => {
    open({ kind: "new" });
    type("Ime storitve", "  Pramenki  ");
    type("Kategorija", "   ");
    fireEvent.click(screen.getByRole("button", { name: "Dodaj korak" }));
    fireEvent.change(screen.getByLabelText("2. korak: minute"), { target: { value: "45" } });
    fireEvent.click(box("Bor"));
    await save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith({
      name: "Pramenki",
      category: null,
      steps: [
        { kind: "busy", minutes: 30 },
        { kind: "busy", minutes: 45 },
      ],
      workerMemberIds: [ANA],
      priceCents: null, // Flowko U29e: E8 — a required key; a new service has no price until Task 9's field
    });
    expect(mocks.toast).toHaveBeenCalledWith("Storitev je shranjena.", "success");
    expect(mocks.onChanged).toHaveBeenCalled();
    expect(mocks.onClose).toHaveBeenCalled();
  });

  it("saves with nobody ticked (allowed; listed as „Nihče“)", async () => {
    open({ kind: "new" });
    type("Ime storitve", "Posvet");
    fireEvent.click(box("Ana"));
    fireEvent.click(box("Bor"));
    expect(
      screen.getByText("Storitve, ki je nihče ne izvaja, na koledarju ni mogoče izbrati.")
    ).toBeInTheDocument();
    await save();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ workerMemberIds: [] }))
    );
  });
});

// Flowko U29b (D1 c): „Shrani“ stays off until the S17 refresh has finished, so a double click sends one write.
describe("ServiceSheet: busy until the refresh is done", () => {
  it("while onChanged is pending „Shrani“ is disabled and a second click does not save again", async () => {
    const refresh = deferred();
    mocks.onChanged.mockReturnValue(refresh.promise);
    open({ kind: "new" });
    type("Ime storitve", "Pramenki");
    await save();
    await waitFor(() => expect(mocks.onChanged).toHaveBeenCalledTimes(1));
    expect(mocks.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Shrani" })).toBeDisabled();
    await save();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      refresh.resolve();
    });
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
  });

  it("after a failed save „Shrani“ is live again", async () => {
    mocks.save.mockRejectedValueOnce(trpcError("service_name_taken"));
    open({ kind: "new" });
    type("Ime storitve", "striženje");
    await save();
    await waitFor(() => expect(screen.getByRole("button", { name: "Shrani" })).not.toBeDisabled());
  });
});

describe("ServiceSheet: editing a service", () => {
  it("shows the stored values and its steps", () => {
    open(edit());
    expect(screen.getByRole("heading", { name: "Uredi storitev" })).toBeInTheDocument();
    expect(input("Ime storitve").value).toBe("Barvanje");
    expect(input("Kategorija").value).toBe("Barve");
    expect((screen.getByLabelText("2. korak: vrsta") as HTMLSelectElement).value).toBe("processing");
    expect(input("3. korak: minute").value).toBe("15");
    expect(screen.getByTestId("flowko-service-total")).toHaveTextContent("Skupaj: 75 min");
  });

  it("a LOCKED member is disabled with its current state; Bor (not assigned) is unticked", () => {
    open(edit());
    expect(box("Ana")).toBeChecked();
    expect(box("Bor")).not.toBeChecked();
    expect(box("Dan (zaklenjeno)")).toBeChecked();
    expect(box("Dan (zaklenjeno)")).toBeDisabled();
  });

  it("the save carries the id and never names the LOCKED member", async () => {
    open(edit());
    type("Ime storitve", "Barvanje las");
    fireEvent.click(box("Bor"));
    await save();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        id: BARVANJE.id,
        name: "Barvanje las",
        category: "Barve",
        steps: BARVANJE.steps,
        workerMemberIds: [ANA, BOR],
        priceCents: null, // Flowko U29e: E8
      })
    );
  });

  // Flowko U29e: E8 — the sheet sends the stored price back unchanged, so an edit never clears it by omission.
  it("an edit sends the service's stored price unchanged", async () => {
    open(edit({ ...BARVANJE, priceCents: 4500 }));
    type("Ime storitve", "Barvanje las");
    await save();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Barvanje las", priceCents: 4500 })
      )
    );
  });

  it.each([
    [1, "To storitev ima 1 prihodnji termin. Spremembe nanj ne vplivajo: ohrani svoje korake in čas."],
    [2, "To storitev imata 2 prihodnja termina. Spremembe nanju ne vplivajo: ohranita svoje korake in čas."],
    [3, "To storitev imajo 3 prihodnji termini. Spremembe nanje ne vplivajo: ohranijo svoje korake in čas."],
    [5, "To storitev ima 5 prihodnjih terminov. Spremembe nanje ne vplivajo: ohranijo svoje korake in čas."],
  ])("S11: %i future bookings → the note says they keep their steps", (count, text) => {
    open(edit({ ...BARVANJE, futureBookings: count }));
    expect(screen.getByTestId("flowko-service-future-bookings")).toHaveTextContent(text);
  });

  it("S11 in English: one and many", () => {
    mocks.lang.current = "en";
    open(edit({ ...BARVANJE, futureBookings: 1 }));
    expect(screen.getByTestId("flowko-service-future-bookings")).toHaveTextContent(
      "1 upcoming booking has this service. Changes do not affect it: it keeps its own steps and time."
    );
  });

  it("S11: no note without future bookings", () => {
    open(edit(STRIZENJE));
    expect(screen.queryByTestId("flowko-service-future-bookings")).toBeNull();
  });
});

// Flowko U29c (P3): the ticks are the user's toggles over the live rows. A refetch that turns a LOCKED member ACTIVE
// (the sheet stays mounted, keyed by service id) shows it ticked when the server still has the assignment, so
// „Shrani“ never drops it silently; an untick by the user survives the refresh.
describe("ServiceSheet: ticks follow the live rows (P3)", () => {
  const withDan = (status: "ACTIVE" | "LOCKED") => ({
    ...BARVANJE,
    workers: BARVANJE.workers.map((w) => (w.memberId === DAN ? { ...w, status } : w)),
  });
  const renderEdit = (service = withDan("LOCKED")) => {
    const view = render(
      <ServiceSheet
        target={edit(service)}
        members={MEMBERS}
        onClose={mocks.onClose}
        onChanged={mocks.onChanged}
      />
    );
    return (next: typeof service) =>
      view.rerender(
        <ServiceSheet
          target={edit(next)}
          members={MEMBERS}
          onClose={mocks.onClose}
          onChanged={mocks.onChanged}
        />
      );
  };

  it("Dan LOCKED + assigned, then ACTIVE + assigned: Dan is ticked and „Shrani“ sends Dan", async () => {
    const refresh = renderEdit();
    expect(box("Dan (zaklenjeno)")).toBeChecked();
    expect(box("Dan (zaklenjeno)")).toBeDisabled();
    refresh(withDan("ACTIVE"));
    expect(box("Dan")).toBeChecked();
    expect(box("Dan")).not.toBeDisabled();
    await save();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ workerMemberIds: [ANA, DAN] }))
    );
  });

  it("a user untick of Ana survives the rerender", async () => {
    const refresh = renderEdit();
    fireEvent.click(box("Ana"));
    expect(box("Ana")).not.toBeChecked();
    refresh(withDan("ACTIVE"));
    expect(box("Ana")).not.toBeChecked();
    expect(box("Dan")).toBeChecked();
    await save();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ workerMemberIds: [DAN] }))
    );
  });

  it("a user tick of Bor survives the rerender", async () => {
    const refresh = renderEdit();
    fireEvent.click(box("Bor"));
    refresh(withDan("ACTIVE"));
    expect(box("Bor")).toBeChecked();
    await save();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ workerMemberIds: [ANA, BOR, DAN] }))
    );
  });

  it("a member locked meanwhile is shown disabled and never sent", async () => {
    const refresh = renderEdit(withDan("ACTIVE"));
    expect(box("Dan")).toBeChecked();
    refresh(withDan("LOCKED"));
    expect(box("Dan (zaklenjeno)")).toBeDisabled();
    await save();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ workerMemberIds: [ANA] }))
    );
  });
});

// Flowko U29c (P4): a corrupt stored service arrives with steps [] and broken; the owner can re-enter the steps
// (the save validates as always) or remove it.
describe("ServiceSheet: a broken service (P4)", () => {
  it("opens with no steps; the save is refused until the owner adds one, then it validates as always", async () => {
    open(edit(KVAR));
    expect(input("Ime storitve").value).toBe("Kvar");
    expect(screen.queryByLabelText("1. korak: minute")).toBeNull();
    await save();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByText("Dodajte vsaj en korak.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj korak" }));
    type("1. korak: minute", "30");
    await save();
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: KVAR.id, steps: [{ kind: "busy", minutes: 30 }] })
      )
    );
  });

  it("„Odstrani“ removes it", async () => {
    open(edit(KVAR));
    fireEvent.click(screen.getByRole("button", { name: "Odstrani" }));
    const dialog = screen.getByRole("dialog", { name: "Odstrani storitev: Kvar" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Odstrani" }));
    });
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ serviceId: KVAR.id }));
  });
});

describe("ServiceSheet: field rules (S8, S9)", () => {
  const NAME_TEXT = "Vnesite ime storitve (največ 60 znakov).";
  it.each([
    ["an empty name", "Ime storitve", "   ", "flowko-service-name-error", NAME_TEXT],
    ["a 61-character name", "Ime storitve", "x".repeat(61), "flowko-service-name-error", NAME_TEXT],
    [
      "a tab in the name",
      "Ime storitve",
      "Bar\tvanje",
      "flowko-service-name-error",
      "Odstranite prelome vrstic, tabulatorje in druge nevidne znake.",
    ],
    [
      "a 41-character category",
      "Kategorija",
      "x".repeat(41),
      "flowko-service-category-error",
      "Kategorija je predolga (največ 40 znakov).",
    ],
  ])("%s → its text at the field, nothing sent", async (_, label, value, testId, text) => {
    open(edit());
    type(label, value);
    await save();
    expect(screen.getByTestId(testId)).toHaveTextContent(text);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    ["7 minutes", "2", "7", 1, "Vnesite število minut, deljivo s 5 (najmanj 5)."],
    ["a blank minutes field", "1", "", 0, "Vnesite število minut, deljivo s 5 (najmanj 5)."],
    ["485 minutes", "3", "485", 2, "Korak je lahko dolg največ 480 minut (8 ur)."],
  ])("a step of %s → the text under that step", async (_, step, minutes, index, text) => {
    open(edit());
    fireEvent.change(screen.getByLabelText(`${step}. korak: minute`), { target: { value: minutes } });
    await save();
    expect(screen.getByTestId(`flowko-service-step-${index}-error`)).toHaveTextContent(text);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    ["the last step processing", "3", "Zadnji korak mora biti delo s stranko."],
    ["the first step processing", "1", "Prvi korak mora biti delo s stranko."],
  ])("%s → the list's text, shown at once", (_, step, text) => {
    open(edit());
    fireEvent.change(screen.getByLabelText(`${step}. korak: vrsta`), { target: { value: "processing" } });
    expect(screen.getByTestId("flowko-service-steps-error")).toHaveTextContent(text);
  });

  it("a single processing step → no working step", async () => {
    open(edit(FEN));
    fireEvent.change(screen.getByLabelText("1. korak: vrsta"), { target: { value: "processing" } });
    await save();
    expect(screen.getByTestId("flowko-service-steps-error")).toHaveTextContent(
      "Vsaj en korak mora biti delo s stranko."
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("more than 12 hours in total → the total rule", async () => {
    open(edit(STRIZENJE));
    fireEvent.change(screen.getByLabelText("1. korak: minute"), { target: { value: "480" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj korak" }));
    fireEvent.change(screen.getByLabelText("2. korak: minute"), { target: { value: "245" } });
    await save();
    expect(screen.getByTestId("flowko-service-steps-error")).toHaveTextContent(
      "Storitev je lahko dolga največ 12 ur (720 minut)."
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("a stored service over the step cap shows the rule (stored services are not re-validated; a save is)", async () => {
    const nine = Array.from({ length: 9 }, () => ({ kind: "busy" as const, minutes: 10 }));
    open(edit({ ...STRIZENJE, steps: nine, totalMinutes: 90 }));
    await save();
    expect(screen.getByTestId("flowko-service-steps-error")).toHaveTextContent(
      "Storitev ima lahko največ 8 korakov."
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  // Flowko U29b (D1 a): the field error is the accessible description of its input.
  it("an empty name → the name input is aria-invalid and described by the error; the category is not", async () => {
    open({ kind: "new" });
    await save();
    const name = input("Ime storitve");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Vnesite ime storitve (največ 60 znakov).");
    expect(input("Kategorija")).not.toHaveAttribute("aria-invalid");
  });

  it("a too long category → the category input is aria-invalid and described by the error", async () => {
    open(edit());
    type("Kategorija", "x".repeat(41));
    await save();
    const category = input("Kategorija");
    expect(category).toHaveAttribute("aria-invalid", "true");
    expect(category).toHaveAccessibleDescription(/Kategorija je predolga \(največ 40 znakov\)\./);
  });

  it("a name error is not shown before the first save", () => {
    open({ kind: "new" });
    expect(screen.queryByTestId("flowko-service-name-error")).toBeNull();
  });
});

describe("ServiceSheet: server answers", () => {
  it("service_name_taken → the text at the name, the sheet stays open", async () => {
    mocks.save.mockRejectedValue(trpcError("service_name_taken"));
    open({ kind: "new" });
    type("Ime storitve", "striženje");
    await save();
    await waitFor(() =>
      expect(screen.getByTestId("flowko-service-name-error")).toHaveTextContent(
        "Storitev s tem imenom že obstaja."
      )
    );
    expect(mocks.onClose).not.toHaveBeenCalled();
    type("Ime storitve", "Striženje 2");
    expect(screen.queryByTestId("flowko-service-name-error")).toBeNull();
  });

  it("bad_member → its text and the list is refreshed (onChanged); the sheet stays open", async () => {
    mocks.save.mockRejectedValue(trpcError("bad_member"));
    open(edit());
    await save();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Nekdo od izbranih ne more več izvajati storitev. Seznam je osvežen; preverite izbiro in shranite znova.",
        "error"
      )
    );
    expect(mocks.onChanged).toHaveBeenCalled();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["bad_service", "BAD_REQUEST", "Storitve ni bilo mogoče shraniti. Preverite polja in poskusite znova."],
    ["Rate limit exceeded", "TOO_MANY_REQUESTS", "Preveč zahtev. Poskusite znova čez trenutek."],
    ["boom", "INTERNAL_SERVER_ERROR", "Nekaj je šlo narobe."],
  ])("%s → its toast", async (message, code, text) => {
    mocks.save.mockRejectedValue(trpcError(message, code));
    open(edit());
    await save();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  // Flowko U29b (D1 d): the server answers forbidden for an unknown id too, so on an edit it means "gone".
  it("forbidden on an EDIT (another device removed it) → the gone text, the list refreshed, the sheet closed", async () => {
    mocks.save.mockRejectedValue(trpcError("forbidden", "FORBIDDEN"));
    open(edit());
    await save();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Te storitve ni več, odstranil jo je nekdo drug. Seznam je osvežen.",
        "error"
      )
    );
    expect(mocks.toast).not.toHaveBeenCalledWith("Za to nimate dovoljenja.", "error");
    expect(mocks.onChanged).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("forbidden on a NEW service keeps „Za to nimate dovoljenja.“ and the sheet", async () => {
    mocks.save.mockRejectedValue(trpcError("forbidden", "FORBIDDEN"));
    open({ kind: "new" });
    type("Ime storitve", "Pramenki");
    await save();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Za to nimate dovoljenja.", "error"));
    expect(mocks.onChanged).not.toHaveBeenCalled();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("every server code has its text in both languages", () => {
    const sl = localeT("sl");
    const en = localeT("en");
    expect(en("flowko_settings_service_error_gone")).toBe(
      "This service no longer exists; someone else removed it. The list is refreshed."
    );
    for (const code of SERVICE_ERROR_CODES) {
      const key =
        code === "forbidden" || code === "TOO_MANY_REQUESTS"
          ? `flowko_settings_error_${code}`
          : `flowko_settings_service_error_${code}`;
      expect(sl(key)).not.toBe(key);
      expect(en(key)).not.toBe(key);
    }
  });
});

describe("ServiceSheet: remove (S12)", () => {
  const removeButton = () => screen.getByRole("button", { name: "Odstrani" });

  it.each([
    [1, "To storitev ima 1 prihodnji termin. Termin ostane, kot je, s svojimi koraki in imenom storitve."],
    [
      2,
      "To storitev imata 2 prihodnja termina. Termina ostaneta, kot sta, s svojimi koraki in imenom storitve.",
    ],
    [
      3,
      "To storitev imajo 3 prihodnji termini. Termini ostanejo, kot so, s svojimi koraki in imenom storitve.",
    ],
    [
      21,
      "To storitev ima 21 prihodnjih terminov. Termini ostanejo, kot so, s svojimi koraki in imenom storitve.",
    ],
  ])("the dialog shows %i future bookings in the plural form", (count, text) => {
    open(edit({ ...BARVANJE, futureBookings: count }));
    fireEvent.click(removeButton());
    const dialog = screen.getByRole("dialog", { name: "Odstrani storitev: Barvanje" });
    expect(within(dialog).getByTestId("flowko-service-remove-bookings")).toHaveTextContent(text);
    expect(within(dialog).getByText("Odstranjene storitve ni mogoče obnoviti.")).toBeInTheDocument();
  });

  it("without future bookings the dialog says so", () => {
    open(edit(STRIZENJE));
    fireEvent.click(removeButton());
    expect(screen.getByTestId("flowko-service-remove-bookings")).toHaveTextContent(
      "Te storitve nima noben prihodnji termin."
    );
  });

  it("confirm removes the service, then refreshes and closes", async () => {
    open(edit());
    fireEvent.click(removeButton());
    const dialog = screen.getByRole("dialog", { name: "Odstrani storitev: Barvanje" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Odstrani" }));
    });
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ serviceId: BARVANJE.id }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Storitev je odstranjena.", "success"));
    expect(mocks.onChanged).toHaveBeenCalled();
    expect(mocks.onClose).toHaveBeenCalled();
  });

  it("„Prekliči“ in the dialog removes nothing", () => {
    open(edit());
    fireEvent.click(removeButton());
    const dialog = screen.getByRole("dialog", { name: "Odstrani storitev: Barvanje" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Prekliči" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("a refused remove (another device removed it) → the gone text, the list refreshed, the sheet closed", async () => {
    mocks.remove.mockRejectedValue(trpcError("forbidden", "FORBIDDEN"));
    open(edit());
    fireEvent.click(removeButton());
    const dialog = screen.getByRole("dialog", { name: "Odstrani storitev: Barvanje" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Odstrani" }));
    });
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Te storitve ni več, odstranil jo je nekdo drug. Seznam je osvežen.",
        "error"
      )
    );
    expect(mocks.toast).not.toHaveBeenCalledWith("Za to nimate dovoljenja.", "error");
    expect(mocks.onChanged).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  // Flowko U29b (D1 b): Radix would focus the first tabbable control, the destructive „Odstrani“.
  it("opening the dialog focuses „Prekliči“, not the destructive „Odstrani“", async () => {
    open(edit());
    fireEvent.click(removeButton());
    const dialog = screen.getByRole("dialog", { name: "Odstrani storitev: Barvanje" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Prekliči" })).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "Odstrani" })).not.toHaveFocus();
  });

  // Flowko U29b (D1 c): the buttons stay off until the S17 refresh has finished.
  it("while the refresh after a remove is pending the sheet buttons are off; a second confirm removes nothing more", async () => {
    const refresh = deferred();
    mocks.onChanged.mockReturnValue(refresh.promise);
    open(edit());
    fireEvent.click(removeButton());
    const dialog = screen.getByRole("dialog", { name: "Odstrani storitev: Barvanje" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Odstrani" }));
    });
    await waitFor(() => expect(mocks.onChanged).toHaveBeenCalledTimes(1));
    expect(mocks.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Odstrani" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Prekliči" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shrani" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Odstrani" }));
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    await act(async () => {
      refresh.resolve();
    });
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
  });
});
