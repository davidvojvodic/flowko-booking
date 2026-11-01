import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Steps } from "./Steps";

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string, values: { currentStep: number; maxSteps: number }) =>
      `${key}:${values.currentStep}/${values.maxSteps}`,
  }),
}));

describe("Steps (Flowko U14)", () => {
  it("labels the step through the translation", () => {
    render(<Steps maxSteps={5} currentStep={1} />);

    expect(screen.getByText("current_step_of_total:1/5")).toBeInTheDocument();
  });

  it("keeps a caller's own label", () => {
    render(<Steps maxSteps={5} currentStep={2} stepLabel={() => "Own label"} />);

    expect(screen.getByText("Own label")).toBeInTheDocument();
  });
});
