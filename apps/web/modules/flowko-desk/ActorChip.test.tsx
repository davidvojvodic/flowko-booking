// Flowko U28: the „who are you“ chip and its picker (R9). Slovene strings from the real sl file.
// Flowko U28b (B1): no „Kdo ste?“ prompt on the chip; while the actor is unknown (member list loading) no chip.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActorChip } from "./ActorChip";
import { ANA, BOR, CENE, localeT, members } from "./desk.fixture";
import type { DeskActorState } from "./useDeskActor";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

function state(over: Partial<DeskActorState> = {}): DeskActorState {
  return {
    actor: null,
    fixed: false,
    choices: members,
    choose: vi.fn(),
    clear: vi.fn(),
    pickerOpen: false,
    openPicker: vi.fn(),
    closePicker: vi.fn(),
    ...over,
  };
}

describe("ActorChip (U28 R9)", () => {
  it("a worker's chip names her and cannot be changed", () => {
    render(<ActorChip actor={state({ actor: { memberId: ANA, displayName: "Ana" }, fixed: true })} />);
    expect(screen.getByTestId("desk-actor-chip").textContent).toBe("Ste: Ana");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("on a shared device the chip opens the picker", () => {
    const s = state({ actor: { memberId: BOR, displayName: "Bor" } });
    render(<ActorChip actor={s} />);
    fireEvent.click(screen.getByRole("button", { name: "Ste: Bor" }));
    expect(s.openPicker).toHaveBeenCalled();
  });

  it("shows no chip and no „Kdo ste?“ while the actor is not known yet", () => {
    render(<ActorChip actor={state()} />);
    expect(screen.queryByTestId("desk-actor-chip")).toBeNull();
    expect(screen.queryByRole("button", { name: "Kdo ste?" })).toBeNull();
  });

  it("the picker lists the active members and a tap chooses one", () => {
    const s = state({ pickerOpen: true, actor: { memberId: BOR, displayName: "Bor" } });
    render(<ActorChip actor={s} />);
    const dialog = screen.getByRole("dialog");
    const options = within(dialog).getAllByTestId(/^desk-actor-option-/);
    expect(options.map((o) => o.textContent)).toEqual(["Olga", "Ana", "Bor", "Cene", "Rok"]);
    expect(within(dialog).getByTestId(`desk-actor-option-${BOR}`).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(dialog).getByTestId(`desk-actor-option-${CENE}`));
    expect(s.choose).toHaveBeenCalledWith(CENE);
  });
});
