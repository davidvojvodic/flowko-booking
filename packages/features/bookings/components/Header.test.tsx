import { BookerLayouts } from "@calcom/prisma/zod-utils";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Header } from "./Header";

vi.mock("@calcom/features/bookings/Booker/BookerStoreProvider", () => ({
  useBookerStoreContext: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      layout: "month_view",
      setLayout: vi.fn(),
      selectedDate: null,
      setSelectedDate: vi.fn(),
      addToSelectedDate: vi.fn(),
    }),
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({ useIsEmbed: () => false }));
vi.mock("@calcom/atoms/hooks/useIsPlatform", () => ({ useIsPlatform: () => false }));
vi.mock("@calcom/features/bookings/hooks/useInitializeWeekStart", () => ({
  useInitializeWeekStart: vi.fn(),
}));
vi.mock("@calcom/features/bookings/components/TimeFormatToggle", () => ({ TimeFormatToggle: () => null }));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("@calcom/ui/components/form", () => ({
  ToggleGroup: ({ options }: { options: { value: string; label: ReactNode }[] }) => (
    <div>
      {options.map((option) => (
        <div key={option.value}>{option.label}</div>
      ))}
    </div>
  ),
}));

describe("Booker Header layout toggle", () => {
  it("labels each layout for screen readers without a stray dollar sign", () => {
    render(
      <Header
        extraDays={7}
        isMobile={false}
        enabledLayouts={[BookerLayouts.MONTH_VIEW, BookerLayouts.WEEK_VIEW, BookerLayouts.COLUMN_VIEW]}
        nextSlots={3}
        eventSlug="consultation"
        isMyLink={false}
      />
    );

    for (const label of ["switch_monthly", "switch_weekly", "switch_columnview"]) {
      const srLabel = screen.getByText(label);
      expect(srLabel).toHaveClass("sr-only");
      expect(srLabel.textContent).toBe(label);
    }
  });
});
