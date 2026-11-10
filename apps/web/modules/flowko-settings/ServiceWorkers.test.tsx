// Flowko U29a: who does a service (S10). ACTIVE OWNER/WORKER members are checkboxes (desk-only included); a LOCKED
// member is shown disabled with its current state in the desk's „(zaklenjeno)“ form and never changes here; with
// nobody ticked the list says the calendar cannot book the service.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServiceWorkers } from "./ServiceWorkers";
import { ANA, BARVANJE, BOR, DAN, localeT } from "./settings.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const box = (name: string) => screen.getByRole("checkbox", { name });

function setup(checked: number[], rows = BARVANJE.workers) {
  const onToggle = vi.fn();
  render(<ServiceWorkers rows={rows} checked={checked} onToggle={onToggle} />);
  return onToggle;
}

describe("ServiceWorkers (U29a S10)", () => {
  it("ACTIVE members are checkboxes in roster order, ticked as given", () => {
    setup([ANA]);
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(box("Ana")).toBeChecked();
    expect(box("Ana")).not.toBeDisabled();
    expect(box("Bor")).not.toBeChecked();
    expect(box("Bor")).not.toBeDisabled();
  });

  it("a LOCKED member is disabled and shows its stored state, whatever is ticked", () => {
    setup([ANA]);
    expect(box("Dan (zaklenjeno)")).toBeDisabled();
    expect(box("Dan (zaklenjeno)")).toBeChecked();
    expect(screen.getByText("Zaklenjenih oseb tukaj ni mogoče dodati ali odstraniti.")).toBeInTheDocument();
  });

  it("a LOCKED member not assigned stays unticked and disabled", () => {
    const rows = BARVANJE.workers.map((w) => (w.memberId === DAN ? { ...w, assigned: false } : w));
    setup([ANA, DAN], rows);
    expect(box("Dan (zaklenjeno)")).toBeDisabled();
    expect(box("Dan (zaklenjeno)")).not.toBeChecked();
  });

  // Flowko U29c (P3): one toggle per click, for that member only; the sheet keeps the overrides.
  it("each click is one onToggle(memberId, on) for that member only", () => {
    const onToggle = setup([ANA]);
    fireEvent.click(box("Bor"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenLastCalledWith(BOR, true);
    fireEvent.click(box("Ana"));
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenLastCalledWith(ANA, false);
  });

  it("a LOCKED member never toggles", () => {
    const onToggle = setup([ANA]);
    fireEvent.click(box("Dan (zaklenjeno)"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("with nobody ticked it says the calendar cannot book the service", () => {
    setup([]);
    expect(
      screen.getByText("Storitve, ki je nihče ne izvaja, na koledarju ni mogoče izbrati.")
    ).toBeInTheDocument();
  });

  it("no hint while someone is ticked; no locked hint without a LOCKED member", () => {
    setup(
      [ANA],
      BARVANJE.workers.filter((w) => w.memberId !== DAN)
    );
    expect(screen.queryByText("Storitve, ki je nihče ne izvaja, na koledarju ni mogoče izbrati.")).toBeNull();
    expect(screen.queryByText("Zaklenjenih oseb tukaj ni mogoče dodati ali odstraniti.")).toBeNull();
  });

  it("no column member at all says so", () => {
    setup([], []);
    expect(screen.getByText("V podjetju ni nikogar, ki bi lahko izvajal storitve.")).toBeInTheDocument();
  });
});
