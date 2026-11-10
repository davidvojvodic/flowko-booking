// Flowko U29b (Task 8, S12, D6): the Urnik cell editor. Choices „Običajno“ (week mode only; the usual entries read
// only), „Prosto“, „Izmene“; the from–to rows with „Dodaj izmeno“ up to four rows; the day's opening hours as a
// hint; shiftDaySchema's error under the rows; „Uporabi“ hands the value to the caller (the draft) and nothing else.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RosterCellSheet } from "./RosterCellSheet";
import { localeT } from "./desk.fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));

const s = (from: string, to: string) => ({ from, to });
const USUAL = [s("08:00", "16:00")];
const onApply = vi.fn();
const onClose = vi.fn();

function open(over: Partial<Parameters<typeof RosterCellSheet>[0]> = {}) {
  return render(
    <RosterCellSheet
      title="Ana · torek, 17. 11."
      mode="week"
      value={null}
      usualEntries={USUAL}
      opening={[s("08:00", "19:00")]}
      closed={false}
      onApply={onApply}
      onClose={onClose}
      {...over}
    />
  );
}

const dialog = () => screen.getByRole("dialog", { name: "Ana · torek, 17. 11." });
const apply = () => within(dialog()).getByRole("button", { name: "Uporabi" }) as HTMLButtonElement;
const choice = (name: string) => within(dialog()).getByRole("button", { name }) as HTMLButtonElement;
const select = (row: number, edge: "from" | "to") =>
  screen.getByTestId(`roster-sheet-rows-${row}-${edge}`) as HTMLSelectElement;

beforeEach(() => {
  onApply.mockReset();
  onClose.mockReset();
});
afterEach(cleanup);

describe("RosterCellSheet (S12)", () => {
  it("titles the sheet with the worker and the day", () => {
    open();
    expect(dialog()).toBeTruthy();
  });

  it("shows the day's opening hours as a hint, or „Zaprto“", () => {
    open();
    expect(screen.getByTestId("roster-sheet-hint").textContent).toBe("Odprto 08:00–19:00");
    cleanup();
    open({ opening: [s("08:00", "12:00"), s("14:00", "18:00")] });
    expect(screen.getByTestId("roster-sheet-hint").textContent).toBe("Odprto 08:00–12:00, 14:00–18:00");
    cleanup();
    open({ opening: [] });
    expect(screen.getByTestId("roster-sheet-hint").textContent).toBe("Zaprto");
    cleanup();
    open({ closed: true });
    expect(screen.getByTestId("roster-sheet-hint").textContent).toBe("Zaprto");
  });

  it("„Običajno“ is chosen for a day that follows the usual week and shows the usual entries read only", () => {
    open({ value: null });
    expect(choice("Običajno").getAttribute("aria-pressed")).toBe("true");
    expect(choice("Prosto").getAttribute("aria-pressed")).toBe("false");
    expect(select(0, "from").value).toBe("08:00");
    expect(select(0, "to").value).toBe("16:00");
    expect(select(0, "from").disabled).toBe(true);
    expect(select(0, "to").disabled).toBe(true);
    expect(screen.getByTestId("roster-sheet-rows-add")).toHaveProperty("disabled", true);
  });

  it("„Običajno“ with a usual day off shows „Prosto“, not „Zaprto“", () => {
    open({ value: null, usualEntries: [] });
    expect(screen.getByTestId("roster-sheet-rows-closed").textContent).toBe("Prosto");
    expect(screen.queryByText("Zaprto")).toBeNull();
  });

  it("an empty planned day shows „Prosto“ in the rows (not „Zaprto“) and „Prosto“ is chosen", () => {
    open({ value: [] });
    expect(screen.getByTestId("roster-sheet-rows-closed").textContent).toBe("Prosto");
    expect(screen.queryByText("Zaprto")).toBeNull();
    expect(choice("Prosto").getAttribute("aria-pressed")).toBe("true");
    expect(choice("Običajno").getAttribute("aria-pressed")).toBe("false");
  });

  it("opens on the stored shifts with „Izmene“ chosen, editable", () => {
    open({ value: [s("09:00", "12:00"), s("13:00", "17:00")] });
    expect(choice("Izmene").getAttribute("aria-pressed")).toBe("true");
    expect(select(1, "from").value).toBe("13:00");
    expect(select(1, "from").disabled).toBe(false);
  });

  it("„Uporabi“ with „Običajno“ hands over null and calls nothing else", () => {
    open({ value: null });
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("„Prosto“ then „Uporabi“ hands over an empty list", () => {
    open({ value: [s("09:00", "12:00")] });
    fireEvent.click(choice("Prosto"));
    expect(screen.getByTestId("roster-sheet-rows-closed")).toBeTruthy();
    expect(choice("Prosto").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("editing a time hands over the new shifts; „Dodaj izmeno“ adds a row", () => {
    open({ value: [s("09:00", "12:00")] });
    fireEvent.change(select(0, "to"), { target: { value: "13:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj izmeno" }));
    expect(select(1, "from").value).toBe("13:00");
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith([s("09:00", "13:00"), s("13:00", "14:00")]);
  });

  it("from „Običajno“, „Izmene“ copies the usual entries into editable rows", () => {
    open({ value: null });
    fireEvent.click(choice("Izmene"));
    expect(choice("Izmene").getAttribute("aria-pressed")).toBe("true");
    expect(select(0, "from").value).toBe("08:00");
    expect(select(0, "from").disabled).toBe(false);
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith([s("08:00", "16:00")]);
  });

  it("from a day off, „Izmene“ starts one 08:00–16:00 shift", () => {
    open({ value: [], usualEntries: [] });
    fireEvent.click(choice("Izmene"));
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith([s("08:00", "16:00")]);
  });

  it("the fourth row is the last: „Dodaj izmeno“ is disabled at four rows", () => {
    open({ value: [s("08:00", "09:00"), s("09:00", "10:00"), s("10:00", "11:00")] });
    const add = screen.getByRole("button", { name: "Dodaj izmeno" }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(screen.getByTestId("roster-sheet-rows-3-from")).toBeTruthy();
    expect(add.disabled).toBe(true);
  });

  it("shows shiftDaySchema's error under the rows and holds „Uporabi“ back", () => {
    open({ value: [s("09:00", "12:00"), s("13:00", "17:00")] });
    fireEvent.change(select(1, "from"), { target: { value: "11:00" } });
    expect(screen.getByTestId("roster-sheet-rows-error").textContent).toBe(
      "Časi se prekrivajo ali niso po vrsti."
    );
    expect(select(1, "from").getAttribute("aria-invalid")).toBe("true");
    expect(apply().disabled).toBe(true);
    fireEvent.click(apply());
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.change(select(1, "from"), { target: { value: "13:00" } });
    expect(screen.queryByTestId("roster-sheet-rows-error")).toBeNull();
    expect(apply().disabled).toBe(false);
  });

  it("an end not after the start is refused with its own text", () => {
    open({ value: [s("09:00", "12:00")] });
    fireEvent.change(select(0, "to"), { target: { value: "09:00" } });
    expect(screen.getByTestId("roster-sheet-rows-error").textContent).toBe(
      "Konec mora biti pozneje kot začetek."
    );
    expect(apply().disabled).toBe(true);
  });

  it("the usual-week mode has no „Odsotnost“ and no „Običajno“, and never hands over null", () => {
    open({ mode: "usual", value: [s("08:00", "16:00")], usualEntries: [] });
    expect(screen.queryByText("Odsotnost")).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: "Običajno" })).toBeNull();
    expect(choice("Prosto")).toBeTruthy();
    fireEvent.click(choice("Prosto"));
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("the absence place is the caller's: children show in the week mode sheet", () => {
    open({ children: <div data-testid="absence-slot">odsotnost</div> });
    expect(screen.getByTestId("absence-slot")).toBeTruthy();
  });

  it("„Prekliči“ closes without applying", () => {
    open({ value: [] });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Prekliči" }));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
