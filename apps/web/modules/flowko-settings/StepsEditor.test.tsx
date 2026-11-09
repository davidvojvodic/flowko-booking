// Flowko U29a: the service steps (S9). StepsBar draws a service's steps as a small bar (busy solid, processing
// hatched, widths by minutes, as on the desk); StepsEditor edits them: kind „Z delom“/„Učinkovanje“ and minutes per
// row, add/remove/reorder, the live total and bar, the rules always shown, each row's and the list's error text.
// Controlled: every edit is one onChange with the whole list.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { draftSteps, type StepDraft, StepsBar, StepsEditor, toDrafts } from "./StepsEditor";
import { localeT } from "./settings.fixture";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: localeT("sl") }) }));

const COLOURING = toDrafts([
  { kind: "busy", minutes: 30 },
  { kind: "processing", minutes: 30 },
  { kind: "busy", minutes: 15 },
]);

function setup(
  value: StepDraft[] = COLOURING,
  errors: { step?: Record<number, string>; list?: string } = {}
) {
  const onChange = vi.fn();
  render(<StepsEditor value={value} onChange={onChange} stepErrors={errors.step} listError={errors.list} />);
  return onChange;
}

const kinds = (calls: StepDraft[]) => calls.map((s) => `${s.kind}:${s.minutes}`);
const lastValue = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)?.[0] as StepDraft[];

describe("StepsBar (U29a S9)", () => {
  it("draws busy steps solid and processing steps hatched, sized by their minutes", () => {
    render(
      <StepsBar
        steps={[
          { kind: "busy", minutes: 30 },
          { kind: "processing", minutes: 30 },
          { kind: "busy", minutes: 15 },
        ]}
      />
    );
    const bar = screen.getByTestId("flowko-steps-bar");
    const segments = Array.from(bar.children) as HTMLElement[];
    expect(segments.map((s) => s.dataset.kind)).toEqual(["busy", "processing", "busy"]);
    expect(segments.map((s) => s.dataset.pattern)).toEqual([undefined, "hatched", undefined]);
    expect(segments.map((s) => s.style.flexGrow)).toEqual(["30", "30", "15"]);
    expect(segments[1]).toHaveClass("border-dashed");
    expect(bar).toHaveAttribute("aria-label", "Delo 30 min, Učinkovanje 30 min, Delo 15 min");
  });
});

describe("StepsEditor (U29a S9)", () => {
  it("shows each step's kind and minutes, the live total and bar, and the rules", () => {
    setup();
    expect((screen.getByLabelText("1. korak: vrsta") as HTMLSelectElement).value).toBe("busy");
    expect((screen.getByLabelText("2. korak: vrsta") as HTMLSelectElement).value).toBe("processing");
    expect((screen.getByLabelText("3. korak: minute") as HTMLInputElement).value).toBe("15");
    const kindOptions = within(screen.getByLabelText("2. korak: vrsta")).getAllByRole("option");
    expect(kindOptions.map((o) => o.textContent)).toEqual(["Delo", "Učinkovanje"]);
    expect(screen.getByTestId("flowko-service-total")).toHaveTextContent("Skupaj: 75 min");
    expect(screen.getByTestId("flowko-steps-bar").children).toHaveLength(3);
    expect(
      screen.getByText("Največ 8 korakov, vsak od 5 do 480 minut (5, 10, 15 … minut), skupaj največ 12 ur.")
    ).toBeInTheDocument();
    expect(screen.getByText(/Učinkovanje: stranka čaka, delavec je medtem prost/)).toBeInTheDocument();
  });

  it("the minutes input carries the S9 bounds", () => {
    setup();
    const minutes = screen.getByLabelText("1. korak: minute") as HTMLInputElement;
    expect(minutes).toHaveAttribute("min", "5");
    expect(minutes).toHaveAttribute("max", "480");
    expect(minutes).toHaveAttribute("step", "5");
  });

  it("the total follows typed minutes (a blank field counts as 0)", () => {
    setup(toDrafts([{ kind: "busy", minutes: 30 }]).map((s) => ({ ...s, minutes: "" })));
    expect(screen.getByTestId("flowko-service-total")).toHaveTextContent("Skupaj: 0 min");
  });

  it("a changed kind or minutes is one onChange with the whole list", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("3. korak: vrsta"), { target: { value: "processing" } });
    expect(kinds(lastValue(onChange))).toEqual(["busy:30", "processing:30", "processing:15"]);
    fireEvent.change(screen.getByLabelText("1. korak: minute"), { target: { value: "40" } });
    expect(kinds(lastValue(onChange))).toEqual(["busy:40", "processing:30", "busy:15"]);
  });

  it("„Dodaj korak“ appends a 15-minute working step with a new key", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj korak" }));
    const next = lastValue(onChange);
    expect(kinds(next)).toEqual(["busy:30", "processing:30", "busy:15", "busy:15"]);
    expect(new Set(next.map((s) => s.key)).size).toBe(4);
  });

  it("„Dodaj korak“ is off at 8 steps", () => {
    setup(toDrafts(Array.from({ length: 8 }, () => ({ kind: "busy" as const, minutes: 15 }))));
    expect(screen.getByRole("button", { name: "Dodaj korak" })).toBeDisabled();
  });

  it("a step can be removed, but not the only one", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: "2. korak: odstrani" }));
    expect(kinds(lastValue(onChange))).toEqual(["busy:30", "busy:15"]);
  });

  it("the only step has no working remove button", () => {
    setup(toDrafts([{ kind: "busy", minutes: 30 }]));
    expect(screen.getByRole("button", { name: "1. korak: odstrani" })).toBeDisabled();
  });

  it("steps move up and down; the first cannot go up, the last cannot go down", () => {
    const onChange = setup();
    expect(screen.getByRole("button", { name: "1. korak: premakni gor" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3. korak: premakni dol" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2. korak: premakni dol" }));
    expect(kinds(lastValue(onChange))).toEqual(["busy:30", "busy:15", "processing:30"]);
    fireEvent.click(screen.getByRole("button", { name: "2. korak: premakni gor" }));
    expect(kinds(lastValue(onChange))).toEqual(["processing:30", "busy:30", "busy:15"]);
  });

  it("shows a step's error under its row and the list's error under the steps", () => {
    setup(COLOURING, {
      step: { 1: "Vnesite število minut, deljivo s 5 (najmanj 5)." },
      list: "Zadnji korak mora biti delo s stranko.",
    });
    expect(screen.getByTestId("flowko-service-step-1-error")).toHaveTextContent(
      "Vnesite število minut, deljivo s 5 (najmanj 5)."
    );
    expect(screen.queryByTestId("flowko-service-step-0-error")).toBeNull();
    expect(screen.getByTestId("flowko-service-steps-error")).toHaveTextContent(
      "Zadnji korak mora biti delo s stranko."
    );
  });

  it("draftSteps turns the drafts into numbers (blank → 0, which the rules refuse)", () => {
    expect(draftSteps([...COLOURING, { key: 9, kind: "busy", minutes: "" }])).toEqual([
      { kind: "busy", minutes: 30 },
      { kind: "processing", minutes: 30 },
      { kind: "busy", minutes: 15 },
      { kind: "busy", minutes: 0 },
    ]);
  });
});
