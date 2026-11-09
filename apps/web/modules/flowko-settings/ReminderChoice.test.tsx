// Flowko U29a: the reminder choice (S5): the four U22 choices as radios, the stored offsets checked, a pick sends
// that choice's offsets; the page states that each reminder is one e-mail per booking.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReminderChoice, reminderChoiceOf } from "./ReminderChoice";
import { localeT } from "./settings.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const radio = (name: string) => screen.getByRole("radio", { name });

describe("ReminderChoice (U29a S5)", () => {
  it("maps stored offsets to a choice id", () => {
    expect(reminderChoiceOf([])).toBe("none");
    expect(reminderChoiceOf([1440])).toBe("day_before");
    expect(reminderChoiceOf([120])).toBe("two_hours_before");
    expect(reminderChoiceOf([1440, 120])).toBe("day_and_two_hours_before");
    expect(reminderChoiceOf([120, 1440])).toBeNull();
    expect(reminderChoiceOf([60])).toBeNull();
  });

  it("shows the four choices with the stored one checked, and the e-mail volume note", () => {
    render(<ReminderChoice value={[1440]} onChange={vi.fn()} />);
    expect(radio("Brez opomnika")).toHaveAttribute("aria-checked", "false");
    expect(radio("24 ur prej")).toHaveAttribute("aria-checked", "true");
    expect(radio("2 uri prej")).toHaveAttribute("aria-checked", "false");
    expect(radio("24 ur in 2 uri prej")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("flowko-settings-reminders-hint")).toHaveTextContent(
      "Vsak opomnik je eno e-poštno sporočilo na termin."
    );
  });

  it.each([
    ["Brez opomnika", []],
    ["2 uri prej", [120]],
    ["24 ur in 2 uri prej", [1440, 120]],
  ])("picking „%s“ sends its offsets", (name, offsets) => {
    const onChange = vi.fn();
    render(<ReminderChoice value={[1440]} onChange={onChange} />);
    fireEvent.click(radio(name));
    expect(onChange).toHaveBeenCalledWith(offsets);
  });
});
