// Flowko U29b (Task 7, S10, S11, S13): one roster cell: shifts one per line, „Prosto“, „Odsotnost“ with the hatch,
// muted usual entries, the differing-day marker, the changed highlight, the closed-holiday band, tappable only when
// editable and a handler is given.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type RosterCellModel, RosterCell } from "./RosterCell";
import { localeT } from "./desk.fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl" } }),
}));

const model = (over: Partial<RosterCellModel> = {}): RosterCellModel => ({
  memberId: 2,
  key: "2026-11-16",
  entries: [{ from: "08:00", to: "16:00" }],
  source: "planned",
  absent: false,
  differsFromUsual: false,
  changed: false,
  editable: false,
  ...over,
});

const cell = () => screen.getByTestId("roster-cell-2-2026-11-16");

describe("RosterCell (U29b Task 7)", () => {
  afterEach(cleanup);

  it("lists the shifts one per line", () => {
    render(
      <RosterCell
        model={model({
          entries: [
            { from: "08:00", to: "12:00" },
            { from: "13:00", to: "17:00" },
          ],
        })}
        closed={false}
      />
    );
    expect(cell().textContent).toBe("08:00–12:0013:00–17:00");
    expect(screen.getAllByTestId("roster-cell-shift").map((s) => s.textContent)).toEqual([
      "08:00–12:00",
      "13:00–17:00",
    ]);
  });

  it("shows „Prosto“ for a day without shifts", () => {
    render(<RosterCell model={model({ entries: [] })} closed={false} />);
    expect(cell().textContent).toBe("Prosto");
  });

  it("shows „Odsotnost“ only, with the hatch and no shifts, for an absent day", () => {
    render(<RosterCell model={model({ absent: true })} closed={false} />);
    expect(cell().textContent).toBe("Odsotnost");
    expect(cell().getAttribute("data-absent")).toBe("true");
    expect(cell().className).toContain("bg-subtle");
    expect(cell().getAttribute("data-pattern")).toBe("hatched");
  });

  it("mutes entries that come from the usual week, not planned ones", () => {
    const { rerender } = render(<RosterCell model={model({ source: "usual" })} closed={false} />);
    expect(screen.getByTestId("roster-cell-shift").className).toContain("text-subtle");
    rerender(<RosterCell model={model({ source: "planned" })} closed={false} />);
    expect(screen.getByTestId("roster-cell-shift").className).not.toContain("text-subtle");
  });

  it("marks a day that differs from the usual week with a labelled dot", () => {
    const { rerender } = render(<RosterCell model={model()} closed={false} />);
    expect(screen.queryByTestId("roster-differs")).toBeNull();
    rerender(<RosterCell model={model({ differsFromUsual: true })} closed={false} />);
    expect(screen.getByTestId("roster-differs").getAttribute("aria-label")).toBe(
      "Drugače kot v običajnem tednu"
    );
    // UI-2: the dot sits in the corner, clear of a two-shift cell's last digit.
    expect(screen.getByTestId("roster-differs").className).toContain("right-0.5 top-0.5");
  });

  it("highlights a changed cell and drops it again", () => {
    const { rerender } = render(
      <RosterCell model={model({ changed: true, source: "draft" })} closed={false} />
    );
    expect(cell().getAttribute("data-changed")).toBe("true");
    expect(cell().className).toContain("ring-2");
    expect(cell().className).toContain("ring-brand-default");
    rerender(<RosterCell model={model()} closed={false} />);
    expect(cell().getAttribute("data-changed")).toBeNull();
    expect(cell().className).not.toContain("ring-brand-default");
  });

  it("greys a closed holiday column", () => {
    render(<RosterCell model={model()} closed />);
    expect(cell().className).toContain("bg-muted");
  });

  it("is a button only when editable and a handler is given", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<RosterCell model={model()} closed={false} onSelect={onSelect} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<RosterCell model={model({ editable: true })} closed={false} onSelect={onSelect} />);
    expect(cell().getAttribute("data-editable")).toBe("true");
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ memberId: 2, key: "2026-11-16" }));
  });

  describe("accessible name (final review UI-4)", () => {
    const named = (over: Partial<RosterCellModel>, editable = true) => {
      render(
        <RosterCell
          model={model({ editable, ...over })}
          closed={false}
          onSelect={vi.fn()}
          label="Ana, torek, 17. 11."
        />
      );
    };

    it("a plain planned cell: worker, day and value only", () => {
      named({});
      expect(screen.getByRole("button", { name: "Ana, torek, 17. 11.: 08:00–16:00" })).toBeTruthy();
    });

    it("a changed cell says it is unsaved", () => {
      named({ changed: true, source: "draft" });
      expect(
        screen.getByRole("button", { name: "Ana, torek, 17. 11.: 08:00–16:00, Neshranjeno" })
      ).toBeTruthy();
    });

    it("a day that differs from the usual week says so", () => {
      named({ differsFromUsual: true });
      expect(
        screen.getByRole("button", {
          name: "Ana, torek, 17. 11.: 08:00–16:00, Drugače kot v običajnem tednu",
        })
      ).toBeTruthy();
    });

    it("a changed day that also differs says both", () => {
      named({ changed: true, differsFromUsual: true, source: "draft" });
      expect(
        screen.getByRole("button", {
          name: "Ana, torek, 17. 11.: 08:00–16:00, Neshranjeno, Drugače kot v običajnem tednu",
        })
      ).toBeTruthy();
    });

    it("a day that follows the usual week says so", () => {
      named({ source: "usual" });
      expect(screen.getByRole("button", { name: "Ana, torek, 17. 11.: 08:00–16:00, Običajno" })).toBeTruthy();
    });

    it("a read-only cell also carries worker and day and its state (not a button)", () => {
      named({ source: "usual" }, false);
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByRole("group", { name: "Ana, torek, 17. 11.: 08:00–16:00, Običajno" })).toBeTruthy();
    });

    it("without a label nothing is named", () => {
      render(<RosterCell model={model()} closed={false} />);
      expect(screen.queryByRole("group")).toBeNull();
    });
  });
});
