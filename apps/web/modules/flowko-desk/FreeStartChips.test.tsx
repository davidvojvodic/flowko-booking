// Flowko U28: „Prosti termini“ (R10): the chosen worker's starts from bookings.freeStarts (never computed in the
// browser), asked only once services are chosen; a chip sets the time.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ANA, BOR, DATE, TZ, iso, localeT } from "./desk.fixture";
import { deskTrpc, resetDeskTrpc } from "./desk.testDoubles";
import { FreeStartChips } from "./FreeStartChips";

vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const answer = {
  date: DATE,
  timeZone: TZ,
  slotStepMinutes: 15,
  holiday: null,
  workers: [
    { memberId: ANA, displayName: "Ana", starts: [iso("10:40"), iso("11:00")], googleUnavailable: false },
    { memberId: BOR, displayName: "Bor", starts: [iso("13:30"), iso("14:00")], googleUnavailable: true },
  ],
};

describe("FreeStartChips (U28 R10)", () => {
  beforeEach(() => resetDeskTrpc());

  it("waits for services before asking", () => {
    render(
      <FreeStartChips date={DATE} serviceIds={[]} memberId={BOR} timeZone={TZ} value="" onPick={vi.fn()} />
    );
    expect(deskTrpc.freeStartsQuery).toHaveBeenCalledWith(
      { date: DATE, serviceIds: [] },
      expect.objectContaining({ enabled: false })
    );
    expect(screen.getByText("Izberite storitve, da vidite proste termine.")).toBeInTheDocument();
  });

  it("shows the chosen worker's starts and a chip sets the time", () => {
    deskTrpc.freeStartsQuery.mockReturnValue({ data: answer, isFetching: false });
    const onPick = vi.fn();
    render(
      <FreeStartChips
        date={DATE}
        serviceIds={[3, 2]}
        memberId={BOR}
        timeZone={TZ}
        value="14:00"
        onPick={onPick}
      />
    );
    expect(deskTrpc.freeStartsQuery).toHaveBeenCalledWith(
      { date: DATE, serviceIds: [3, 2] },
      expect.objectContaining({ enabled: true })
    );
    const chips = screen.getAllByTestId("desk-free-start");
    expect(chips.map((c) => c.textContent)).toEqual(["13:30", "14:00"]);
    expect(chips[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Google koledar ni dosegljiv")).toBeInTheDocument();
    fireEvent.click(chips[0]);
    expect(onPick).toHaveBeenCalledWith("13:30");
  });

  it("says when the worker has no free time that day", () => {
    deskTrpc.freeStartsQuery.mockReturnValue({
      data: { ...answer, workers: [{ ...answer.workers[0], starts: [] }] },
      isFetching: false,
    });
    render(
      <FreeStartChips date={DATE} serviceIds={[1]} memberId={ANA} timeZone={TZ} value="" onPick={vi.fn()} />
    );
    expect(screen.getByText("Ta dan ni prostih terminov.")).toBeInTheDocument();
  });
});
