// Flowko U29a: the business profile page (S2, S3, S5, S16, S17). The form shows business.settings, validates with
// businessSettingsSchema (each field code has its text), sends null for an empty address or e-mail, sends the loaded
// updatedAt as expectedUpdatedAt; needs_confirm opens the dialog with both counts and „Vseeno shrani“ resends with
// confirm: true (cancel keeps the edits); settings_changed refetches and says so; every server code has its text;
// a save invalidates business.me, business.settings and the desk's day/week/free-start queries.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BusinessProfileView, { SETTINGS_ERROR_CODES, SETTINGS_FIELD_CODES } from "./business-profile-view";
import { localeStrings, localeT, OPENING, SETTINGS, UPDATED_AT } from "./settings.fixture";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
  invalidateMe: vi.fn(),
  invalidateSettings: vi.fn(),
  invalidateDay: vi.fn(),
  invalidateWeek: vi.fn(),
  invalidateFreeStarts: vi.fn(),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      viewer: {
        flowko: {
          business: {
            me: { invalidate: mocks.invalidateMe },
            settings: { invalidate: mocks.invalidateSettings },
          },
          bookings: {
            day: { invalidate: mocks.invalidateDay },
            week: { invalidate: mocks.invalidateWeek },
            freeStarts: { invalidate: mocks.invalidateFreeStarts },
          },
        },
      },
    }),
    viewer: {
      flowko: {
        business: {
          settings: { useQuery: (...args: unknown[]) => mocks.query(...args) },
          updateSettings: {
            useMutation: () => ({ mutateAsync: (input: unknown) => mocks.update(input), isPending: false }),
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

let data: typeof SETTINGS | undefined;
const queryResult = (over: Record<string, unknown> = {}) => ({
  data,
  isPending: data === undefined,
  isFetching: false,
  error: null,
  refetch: mocks.refetch,
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  data = SETTINGS;
  mocks.query.mockImplementation(() => queryResult());
  mocks.refetch.mockResolvedValue(undefined);
  for (const fn of [
    mocks.invalidateMe,
    mocks.invalidateSettings,
    mocks.invalidateDay,
    mocks.invalidateWeek,
    mocks.invalidateFreeStarts,
  ]) {
    fn.mockResolvedValue(undefined);
  }
});

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "Shrani" });
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });

async function save() {
  await act(async () => {
    fireEvent.click(saveButton());
  });
}

const PAYLOAD = {
  name: "Flowko Test",
  phone: "+386 40 123 456",
  address: "Slovenska cesta 1, Ljubljana",
  email: "salon@example.si",
  openingHours: OPENING,
  slotGridMinutes: 15,
  holidaysClosed: true,
  reminderOffsets: [1440],
  sharedDevice: false,
  expectedUpdatedAt: UPDATED_AT,
  confirm: false,
};

describe("BusinessProfileView: loading", () => {
  it("reads business.settings without suspense or server initial data", () => {
    render(<BusinessProfileView />);
    expect(mocks.query).toHaveBeenCalled();
    const [queryInput, options] = mocks.query.mock.calls[0];
    expect(queryInput).toBeUndefined();
    expect(options).toEqual({ refetchOnWindowFocus: false });
  });

  it("shows a skeleton, not the form, while loading", () => {
    data = undefined;
    render(<BusinessProfileView />);
    expect(screen.getByTestId("flowko-settings-profile-loading")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ime podjetja")).toBeNull();
  });

  it("a failed load says so and retries on request", () => {
    data = undefined;
    mocks.query.mockImplementation(() => queryResult({ isPending: false, error: trpcError("forbidden") }));
    render(<BusinessProfileView />);
    expect(screen.getByText("Nastavitev ni bilo mogoče naložiti.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});

describe("BusinessProfileView: the form shows business.settings", () => {
  it("renders every value", () => {
    render(<BusinessProfileView />);
    expect(input("Ime podjetja").value).toBe("Flowko Test");
    expect(input("Telefon").value).toBe("+386 40 123 456");
    expect(input("Naslov").value).toBe("Slovenska cesta 1, Ljubljana");
    expect(input("E-pošta podjetja").value).toBe("salon@example.si");
    expect(
      screen.getByText(/Ko stranka odgovori na e-poštno sporočilo o svojem terminu/)
    ).toBeInTheDocument();
    expect((screen.getByTestId("flowko-day-ranges-mon-0-from") as HTMLSelectElement).value).toBe("08:00");
    expect((screen.getByTestId("flowko-day-ranges-sat-0-to") as HTMLSelectElement).value).toBe("13:00");
    expect(screen.getByTestId("flowko-day-ranges-sun-closed")).toBeInTheDocument();
    expect((screen.getByLabelText("Razmik med termini") as HTMLSelectElement).value).toBe("15");
    expect(screen.getByRole("radio", { name: "24 ur pred terminom" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByTestId("flowko-settings-holidays-closed")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("flowko-settings-shared-device")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Več oseb uporablja isto napravo")).toBeInTheDocument();
  });

  it("shows the slug as the call page link and the time zone, both read-only", () => {
    render(<BusinessProfileView />);
    const link = screen.getByTestId("flowko-settings-call-page") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/poklicite/flowko-test");
    expect(link.textContent).toContain("/poklicite/flowko-test");
    expect(screen.getByTestId("flowko-settings-time-zone")).toHaveTextContent("Europe/Ljubljana");
    expect(screen.queryByDisplayValue("flowko-test")).toBeNull();
    expect(screen.queryByDisplayValue("Europe/Ljubljana")).toBeNull();
  });

  it("an empty address or e-mail shows as an empty field", () => {
    data = { ...SETTINGS, address: null, email: null };
    render(<BusinessProfileView />);
    expect(input("Naslov").value).toBe("");
    expect(input("E-pošta podjetja").value).toBe("");
  });

  it("„Shrani“ is off until something changes", () => {
    render(<BusinessProfileView />);
    expect(saveButton()).toBeDisabled();
    type("Ime podjetja", "Salon Ana");
    expect(saveButton()).not.toBeDisabled();
  });
});

describe("BusinessProfileView: saving", () => {
  it("an empty address and a blank e-mail are sent as null; values are trimmed, the e-mail lowercased", async () => {
    mocks.update.mockResolvedValue({ status: "saved" });
    render(<BusinessProfileView />);
    type("Ime podjetja", "  Salon Ana  ");
    type("Naslov", "");
    type("E-pošta podjetja", "   ");
    await save();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({ ...PAYLOAD, name: "Salon Ana", address: null, email: null });
  });

  it("a mixed-case e-mail is sent lowercased", async () => {
    mocks.update.mockResolvedValue({ status: "saved" });
    render(<BusinessProfileView />);
    type("E-pošta podjetja", " Info@Salon-Ana.SI ");
    await save();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({ ...PAYLOAD, email: "info@salon-ana.si" });
  });

  it("saved → its toast and every S17 query invalidated", async () => {
    mocks.update.mockResolvedValue({ status: "saved" });
    render(<BusinessProfileView />);
    fireEvent.change(screen.getByLabelText("Razmik med termini"), { target: { value: "30" } });
    await save();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Nastavitve so shranjene.", "success"));
    expect(mocks.update).toHaveBeenCalledWith({ ...PAYLOAD, slotGridMinutes: 30 });
    expect(mocks.invalidateMe).toHaveBeenCalled();
    expect(mocks.invalidateSettings).toHaveBeenCalled();
    expect(mocks.invalidateDay).toHaveBeenCalled();
    expect(mocks.invalidateWeek).toHaveBeenCalled();
    expect(mocks.invalidateFreeStarts).toHaveBeenCalled();
  });

  it("the shared-device switch is saved and invalidates business.me (the desk chip follows it)", async () => {
    mocks.update.mockResolvedValue({ status: "saved" });
    render(<BusinessProfileView />);
    fireEvent.click(screen.getByTestId("flowko-settings-shared-device"));
    await save();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ ...PAYLOAD, sharedDevice: true }));
    await waitFor(() => expect(mocks.invalidateMe).toHaveBeenCalled());
  });

  it("the reminder choice and the holiday switch are saved", async () => {
    mocks.update.mockResolvedValue({ status: "saved" });
    render(<BusinessProfileView />);
    fireEvent.click(screen.getByRole("radio", { name: "2 uri pred terminom" }));
    fireEvent.click(screen.getByTestId("flowko-settings-holidays-closed"));
    await save();
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({ ...PAYLOAD, reminderOffsets: [120], holidaysClosed: false })
    );
  });

  it("an edited opening is saved", async () => {
    mocks.update.mockResolvedValue({ status: "saved" });
    render(<BusinessProfileView />);
    fireEvent.change(screen.getByTestId("flowko-day-ranges-mon-0-from"), { target: { value: "09:00" } });
    await save();
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        ...PAYLOAD,
        openingHours: { ...OPENING, mon: [{ from: "09:00", to: "20:00" }] },
      })
    );
  });
});

describe("BusinessProfileView: needs_confirm (S3)", () => {
  const narrower = { ...OPENING, mon: [{ from: "09:00", to: "20:00" }] };

  async function narrowAndSave() {
    render(<BusinessProfileView />);
    fireEvent.change(screen.getByTestId("flowko-day-ranges-mon-0-from"), { target: { value: "09:00" } });
    await save();
    await waitFor(() => expect(screen.getByText("Vseeno shrani")).toBeInTheDocument());
  }

  it("opens the dialog with both counts; „Vseeno shrani“ resends the same values with confirm: true", async () => {
    mocks.update
      .mockResolvedValueOnce({ status: "needs_confirm", outside: { shifts: 2, bookings: 5 } })
      .mockResolvedValueOnce({ status: "saved" });
    await narrowAndSave();
    expect(screen.getAllByTestId("flowko-settings-outside-line").map((line) => line.textContent)).toEqual([
      "2 dneva z izmeno",
      "5 terminov",
    ]);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.invalidateSettings).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Vseeno shrani" }));
    });
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update).toHaveBeenNthCalledWith(1, { ...PAYLOAD, openingHours: narrower });
    expect(mocks.update).toHaveBeenNthCalledWith(2, { ...PAYLOAD, openingHours: narrower, confirm: true });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Nastavitve so shranjene.", "success"));
    expect(mocks.invalidateSettings).toHaveBeenCalled();
    expect(screen.queryByTestId("flowko-settings-outside-line")).toBeNull();
  });

  it("„Prekliči“ sends nothing more and keeps the edits", async () => {
    mocks.update.mockResolvedValueOnce({ status: "needs_confirm", outside: { shifts: 1, bookings: 0 } });
    await narrowAndSave();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Prekliči" }));
    });
    await waitFor(() => expect(screen.queryByText("Vseeno shrani")).toBeNull());
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId("flowko-day-ranges-mon-0-from") as HTMLSelectElement).value).toBe("09:00");
    expect(saveButton()).not.toBeDisabled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.invalidateSettings).not.toHaveBeenCalled();
  });
});

describe("BusinessProfileView: settings_changed", () => {
  it("refetches, says someone else changed the settings and shows the current ones", async () => {
    mocks.update.mockRejectedValue(trpcError("settings_changed"));
    mocks.refetch.mockImplementation(async () => {
      data = { ...SETTINGS, name: "Salon Zala", updatedAt: new Date("2026-11-16T07:05:00.000Z") };
    });
    render(<BusinessProfileView />);
    type("Ime podjetja", "Salon Ana");
    await save();
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("flowko-settings-changed")).toHaveTextContent(
        "Nastavitve je medtem spremenil nekdo drug."
      )
    );
    expect(input("Ime podjetja").value).toBe("Salon Zala");
    expect(saveButton()).toBeDisabled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("the notice goes away after the next successful save", async () => {
    mocks.update
      .mockRejectedValueOnce(trpcError("settings_changed"))
      .mockResolvedValueOnce({ status: "saved" });
    mocks.refetch.mockImplementation(async () => {
      data = { ...SETTINGS, updatedAt: new Date("2026-11-16T07:05:00.000Z") };
    });
    render(<BusinessProfileView />);
    type("Ime podjetja", "Salon Ana");
    await save();
    await waitFor(() => expect(screen.getByTestId("flowko-settings-changed")).toBeInTheDocument());
    type("Ime podjetja", "Salon Ana");
    await save();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update).toHaveBeenLastCalledWith({
      ...PAYLOAD,
      name: "Salon Ana",
      expectedUpdatedAt: new Date("2026-11-16T07:05:00.000Z"),
    });
    await waitFor(() => expect(screen.queryByTestId("flowko-settings-changed")).toBeNull());
  });
});

// Flowko U29c (P1): the refresh after a save is checked. The probe is business.settings, invalidated with
// { throwOnError: true } (plain invalidate() resolves even when the refetch failed). When it rejects the save stays
// saved: a notice with „Osveži“ shows, „Shrani“ is off (its updatedAt is stale) and „someone else changed it“
// is never said about the owner's own save.
describe("BusinessProfileView: the refresh after a save (P1)", () => {
  const notice = () => screen.queryByTestId("flowko-settings-refresh-failed");
  const NOTICE_TEXT = "Shranjeno, prikaza pa ni bilo mogoče osvežiti. Kliknite Osveži.";

  async function saveWithFailingRefresh() {
    mocks.update.mockResolvedValue({ status: "saved" });
    mocks.invalidateSettings.mockRejectedValue(new Error("offline"));
    render(<BusinessProfileView />);
    fireEvent.change(screen.getByLabelText("Razmik med termini"), { target: { value: "30" } });
    await save();
    await waitFor(() => expect(notice()).toBeInTheDocument());
  }

  it("probes business.settings with throwOnError; the other S17 queries use a plain invalidate", async () => {
    mocks.update.mockResolvedValue({ status: "saved" });
    render(<BusinessProfileView />);
    fireEvent.change(screen.getByLabelText("Razmik med termini"), { target: { value: "30" } });
    await save();
    await waitFor(() => expect(mocks.invalidateSettings).toHaveBeenCalled());
    expect(mocks.invalidateSettings).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
    expect(mocks.invalidateMe).toHaveBeenCalledWith();
    expect(mocks.invalidateDay).toHaveBeenCalledWith();
    expect(mocks.invalidateWeek).toHaveBeenCalledWith();
    expect(mocks.invalidateFreeStarts).toHaveBeenCalledWith();
    expect(notice()).toBeNull();
  });

  it("a failed refresh → the notice with „Osveži“, „Shrani“ off, the saved toast kept, no „changed“ warning", async () => {
    await saveWithFailingRefresh();
    expect(notice()).toHaveTextContent(NOTICE_TEXT);
    expect(notice()).toHaveAttribute("role", "alert");
    expect(screen.getByRole("button", { name: "Osveži" })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(mocks.toast).toHaveBeenCalledWith("Nastavitve so shranjene.", "success");
    expect(screen.queryByTestId("flowko-settings-changed")).toBeNull();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("„Osveži“ runs the probe again; when it answers the notice is gone", async () => {
    await saveWithFailingRefresh();
    mocks.invalidateSettings.mockReset();
    mocks.invalidateSettings.mockResolvedValue(undefined);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Osveži" }));
    });
    expect(mocks.invalidateSettings).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
    await waitFor(() => expect(notice()).toBeNull());
    expect(screen.queryByTestId("flowko-settings-changed")).toBeNull();
  });

  it("„Osveži“ failing again keeps the notice and „Shrani“ off", async () => {
    await saveWithFailingRefresh();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Osveži" }));
    });
    expect(notice()).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});

describe("BusinessProfileView: server error codes", () => {
  it.each([
    [trpcError("forbidden", "FORBIDDEN"), "Za to nimate dovoljenja."],
    [trpcError("bad_profile"), "Podatkov ni bilo mogoče shraniti. Preverite polja in poskusite znova."],
    [trpcError("Rate limit exceeded", "TOO_MANY_REQUESTS"), "Preveč zahtev. Poskusite znova čez trenutek."],
    [new Error("boom"), "Nekaj je šlo narobe."],
  ])("%s → its text", async (error, text) => {
    mocks.update.mockRejectedValue(error);
    render(<BusinessProfileView />);
    type("Ime podjetja", "Salon Ana");
    await save();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(text, "error"));
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(mocks.invalidateSettings).not.toHaveBeenCalled();
    expect(input("Ime podjetja").value).toBe("Salon Ana");
  });
});

describe("BusinessProfileView: field rules (businessSettingsSchema)", () => {
  it.each([
    ["Ime podjetja", "", "Vnesite ime podjetja (največ 80 znakov)."],
    ["Ime podjetja", "Salon\tAna", "Odstranite prelome vrstic, tabulatorje in druge nevidne znake."],
    [
      "Telefon",
      "  ",
      "Vnesite telefonsko številko. Na to številko vas stranke pokličejo, ko želijo termin prestaviti.",
    ],
    [
      "Telefon",
      "nič",
      "Vnesite veljavno telefonsko številko (6 do 20 znakov: števke, presledki, +, -, /, oklepaji).",
    ],
    ["Naslov", "x".repeat(201), "Naslov je predolg (največ 200 znakov)."],
    ["E-pošta podjetja", "salon", "Vnesite veljaven e-poštni naslov."],
    ["E-pošta podjetja", `${"a".repeat(250)}@x.si`, "E-poštni naslov je predolg (največ 254 znakov)."],
    [
      "E-pošta podjetja",
      "x@flowko.invalid",
      "To ni pravi e-poštni naslov. Vnesite naslov, ki ga redno pregledujete.",
    ],
    [
      "E-pošta podjetja",
      "0401234@sms.cal.com",
      "To ni pravi e-poštni naslov. Vnesite naslov, ki ga redno pregledujete.",
    ],
  ])("%s = %j → its text, nothing sent", async (label, value, text) => {
    render(<BusinessProfileView />);
    type(label, value);
    await save();
    await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("an end before the start shows under its day", async () => {
    render(<BusinessProfileView />);
    fireEvent.change(screen.getByTestId("flowko-day-ranges-tue-0-to"), { target: { value: "07:00" } });
    await save();
    await waitFor(() =>
      expect(screen.getByTestId("flowko-day-ranges-tue-error")).toHaveTextContent(
        "Konec mora biti pozneje kot začetek."
      )
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("overlapping ranges show under their day", async () => {
    data = {
      ...SETTINGS,
      openingHours: {
        ...OPENING,
        wed: [
          { from: "08:00", to: "12:00" },
          { from: "13:00", to: "18:00" },
        ],
      },
    };
    render(<BusinessProfileView />);
    fireEvent.change(screen.getByTestId("flowko-day-ranges-wed-1-from"), { target: { value: "11:00" } });
    await save();
    await waitFor(() =>
      expect(screen.getByTestId("flowko-day-ranges-wed-error")).toHaveTextContent(
        "Časi se prekrivajo ali niso po vrsti."
      )
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a week with no open day is refused", async () => {
    render(<BusinessProfileView />);
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat"]) {
      fireEvent.click(screen.getByTestId(`flowko-day-ranges-${day}-0-remove`));
    }
    await save();
    await waitFor(() =>
      expect(screen.getByTestId("flowko-settings-opening-error")).toHaveTextContent(
        "Odprt mora biti vsaj en dan v tednu."
      )
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("every field code and every server code has a text in sl and en", () => {
    expect(SETTINGS_FIELD_CODES).toEqual(
      expect.arrayContaining([
        "name_length",
        "control_character",
        "phone_required",
        "phone_format",
        "address_length",
        "email_length",
        "email_format",
        "email_placeholder",
        "no_open_day",
        "time_format",
        "start_at_24",
        "before_03_00",
        "end_not_after_start",
        "unsorted_or_overlapping",
        "slot_grid",
        "reminder_offsets",
        "invalid",
      ])
    );
    expect(SETTINGS_ERROR_CODES).toEqual([
      "forbidden",
      "bad_profile",
      "settings_changed",
      "TOO_MANY_REQUESTS",
    ]);
    for (const strings of [localeStrings.sl, localeStrings.en]) {
      for (const code of SETTINGS_FIELD_CODES) expect(strings[`flowko_settings_field_${code}`]).toBeTruthy();
      for (const code of SETTINGS_ERROR_CODES) {
        const key =
          code === "settings_changed" ? "flowko_settings_changed_notice" : `flowko_settings_error_${code}`;
        expect(strings[key]).toBeTruthy();
      }
    }
  });
});

// Flowko U29b (Task 1a, D1 a): a field error is tied to its control, the reminder group has a name, and no label
// is left unbound.
describe("BusinessProfileView: accessibility (U29b D1 a)", () => {
  const EMAIL_PLACEHOLDER = "To ni pravi e-poštni naslov. Vnesite naslov, ki ga redno pregledujete.";

  it("a failing save ties the name and e-mail errors to their inputs (aria-invalid + description)", async () => {
    render(<BusinessProfileView />);
    type("Ime podjetja", "");
    type("E-pošta podjetja", "x@salon.flowko.invalid");
    await save();
    await waitFor(() => expect(screen.getByText(EMAIL_PLACEHOLDER)).toBeInTheDocument());
    const name = input("Ime podjetja");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Vnesite ime podjetja (največ 80 znakov).");
    const email = input("E-pošta podjetja");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription(EMAIL_PLACEHOLDER);
    expect(input("Telefon")).not.toHaveAttribute("aria-invalid");
    expect(input("Telefon")).not.toHaveAttribute("aria-describedby");
  });

  it("the slot grid select is tied to its error", async () => {
    render(<BusinessProfileView />);
    fireEvent.change(screen.getByLabelText("Razmik med termini"), { target: { value: "7" } });
    await save();
    const select = screen.getByLabelText("Razmik med termini");
    await waitFor(() => expect(select).toHaveAttribute("aria-invalid", "true"));
    expect(select).toHaveAccessibleDescription(/\S/);
  });

  it("the reminder choices are a named radiogroup", () => {
    render(<BusinessProfileView />);
    expect(screen.getByRole("radiogroup", { name: "Opomnik strankam" })).toBeInTheDocument();
  });

  it("no label is left without a control (call page and time zone are plain text)", () => {
    const { container } = render(<BusinessProfileView />);
    const unbound = Array.from(container.querySelectorAll("label:not([for])")).map(
      (l) => l.textContent ?? ""
    );
    expect(
      unbound.filter((text) => text.includes("Stran za stranke") || text.includes("Časovni pas"))
    ).toEqual([]);
    expect(screen.getByText("Stran za stranke")).toBeInTheDocument();
    expect(screen.getByText("Časovni pas")).toBeInTheDocument();
  });
});
