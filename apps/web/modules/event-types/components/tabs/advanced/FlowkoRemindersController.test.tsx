// Flowko U22: the per-service reminder switch on the Napredno tab (metadata.flowkoReminders).
import type { FormValues } from "@calcom/features/eventtypes/lib/types";
import type { FlowkoReminders } from "@calcom/prisma/zod-utils";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import type { RenderResult } from "@testing-library/react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import type { DefaultValues, UseFormReturn } from "react-hook-form";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FlowkoRemindersController from "./FlowkoRemindersController";

vi.mock("@formkit/auto-animate/react", () => ({
  useAutoAnimate: () => [null],
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

const APPS = { giphy: { enabled: true, thankYouPage: "https://example.com/x.gif" } };

let form: UseFormReturn<FormValues> | undefined;

const renderComponent = (metadata: Record<string, unknown>): RenderResult => {
  const Wrapper = ({ children }: { children: ReactNode }): ReactElement => {
    const methods = useForm<FormValues>({
      defaultValues: { metadata } as unknown as DefaultValues<FormValues>,
    });
    form = methods;
    return (
      <TooltipProvider>
        <FormProvider {...methods}>{children}</FormProvider>
      </TooltipProvider>
    );
  };
  return render(<FlowkoRemindersController />, { wrapper: Wrapper });
};

const toggle = (): HTMLElement => screen.getByTestId("flowko-reminders-toggle");
const radio = (key: string): HTMLElement | null => screen.queryByRole("radio", { name: key });
const reminders = (): FlowkoReminders => form?.getValues("metadata.flowkoReminders");

describe("FlowkoRemindersController", () => {
  beforeEach(() => {
    form = undefined;
  });

  it("starts off when the service has no setting, with no radios", () => {
    renderComponent({ apps: APPS });
    expect(screen.getByText("flowko_reminders_title")).toBeInTheDocument();
    expect(screen.getByText("flowko_reminders_description")).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(radio("flowko_reminders_24h")).toBeNull();
    expect(screen.queryByText("flowko_reminders_hint")).toBeNull();
  });

  it("turning it on stores 24 h and marks the form dirty", () => {
    renderComponent({ apps: APPS });
    fireEvent.click(toggle());
    expect(reminders()).toEqual({ enabled: true, offsets: [1440] });
    expect(form?.formState.dirtyFields.metadata).toBeTruthy();
    expect(radio("flowko_reminders_24h")).toHaveAttribute("aria-checked", "true");
    expect(radio("flowko_reminders_2h")).toHaveAttribute("aria-checked", "false");
    expect(radio("flowko_reminders_both")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("flowko_reminders_hint")).toBeInTheDocument();
  });

  it("choosing both stores [1440, 120]; choosing 2 h stores [120]", () => {
    renderComponent({ apps: APPS });
    fireEvent.click(toggle());
    fireEvent.click(radio("flowko_reminders_both") as HTMLElement);
    expect(reminders()).toEqual({ enabled: true, offsets: [1440, 120] });
    expect(radio("flowko_reminders_both")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radio("flowko_reminders_2h") as HTMLElement);
    expect(reminders()).toEqual({ enabled: true, offsets: [120] });
    expect(radio("flowko_reminders_2h")).toHaveAttribute("aria-checked", "true");
  });

  it("turning it off keeps the offsets and hides the radios", () => {
    renderComponent({ apps: APPS });
    fireEvent.click(toggle());
    fireEvent.click(radio("flowko_reminders_both") as HTMLElement);
    fireEvent.click(toggle());
    expect(reminders()).toEqual({ enabled: false, offsets: [1440, 120] });
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(radio("flowko_reminders_both")).toBeNull();
    // On again: the kept choice comes back.
    fireEvent.click(toggle());
    expect(reminders()).toEqual({ enabled: true, offsets: [1440, 120] });
    expect(radio("flowko_reminders_both")).toHaveAttribute("aria-checked", "true");
  });

  it("shows a saved setting (controlled): on with 2 h checked", () => {
    renderComponent({ apps: APPS, flowkoReminders: { enabled: true, offsets: [120] } });
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(radio("flowko_reminders_2h")).toHaveAttribute("aria-checked", "true");
    expect(radio("flowko_reminders_24h")).toHaveAttribute("aria-checked", "false");
  });

  it("leaves metadata.apps and other metadata keys untouched", () => {
    renderComponent({ apps: APPS, additionalNotesRequired: true });
    fireEvent.click(toggle());
    fireEvent.click(radio("flowko_reminders_both") as HTMLElement);
    fireEvent.click(toggle());
    expect(form?.getValues("metadata.apps")).toEqual(APPS);
    expect(form?.getValues("metadata.additionalNotesRequired")).toBe(true);
  });
});
