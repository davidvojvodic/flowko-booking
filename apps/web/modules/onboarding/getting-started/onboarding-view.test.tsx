import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingView } from "./onboarding-view";

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return {
    push,
    replace,
    // Next's router is stable across renders; a new object each render would re-run the redirect effect.
    router: { push, replace },
    setSelectedPlan: vi.fn(),
    resetOnboardingPreservingPlan: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("../store/onboarding-store", () => ({
  useOnboardingStore: () => ({
    selectedPlan: "personal",
    setSelectedPlan: mocks.setSelectedPlan,
    resetOnboardingPreservingPlan: mocks.resetOnboardingPreservingPlan,
  }),
}));

vi.mock("../components/OnboardingLayout", () => ({
  OnboardingLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/OnboardingCard", () => ({
  OnboardingCard: ({ title, children }: { title: string; children?: ReactNode }) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
}));

vi.mock("../components/onboarding-continuation-prompt", () => ({ OnboardingContinuationPrompt: () => null }));
vi.mock("../components/plan-icon", () => ({ PlanIcon: () => null }));

describe("OnboardingView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips the plan step, since teams don't exist in this fork, and continues to personal onboarding", () => {
    render(<OnboardingView userEmail="owner@example.com" />);

    expect(mocks.setSelectedPlan).toHaveBeenCalledWith("personal");
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/onboarding/personal/settings");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByText("onboarding_plan_team_title")).toBeNull();
    expect(screen.queryByText("onboarding_select_plan")).toBeNull();
    expect(screen.queryByTestId("onboarding-continue-btn")).toBeNull();
  });

  it("still clears a previous onboarding's details before continuing", () => {
    render(<OnboardingView userEmail="owner@example.com" />);

    expect(mocks.resetOnboardingPreservingPlan).toHaveBeenCalledTimes(1);
  });
});
