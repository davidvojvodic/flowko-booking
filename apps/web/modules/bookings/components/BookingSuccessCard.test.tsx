import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingSuccessCard } from "./BookingSuccessCard";
import { DecoyBookingSuccessCard } from "./DecoyBookingSuccessCard";

const locale = vi.hoisted(() => ({ strings: {} as Record<string, string> }));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => locale.strings[key] ?? key }),
}));

const props = {
  title: "Haircut",
  formattedDate: "Friday, 25 September 2026",
  formattedTime: "10:00",
  endTime: "10:30",
  formattedTimeZone: "Europe/Ljubljana",
  hostName: "Salon Lepota",
  hostEmail: null,
  attendeeName: "Ana",
  attendeeEmail: null,
  location: null,
};

describe("BookingSuccessCard host badge", () => {
  beforeEach(() => {
    locale.strings = en as unknown as Record<string, string>;
  });

  it("translates the host badge", () => {
    locale.strings = sl as unknown as Record<string, string>;
    render(<BookingSuccessCard {...props} />);

    expect(screen.getByText(sl.host)).toBeInTheDocument();
    expect(screen.queryByText("Host")).toBeNull();
  });

  it("keeps the decoy card identical to the real one", () => {
    const real = render(<BookingSuccessCard {...props} />).container.innerHTML;
    cleanup();
    const decoy = render(<DecoyBookingSuccessCard {...props} />).container.innerHTML;

    expect(decoy).toBe(real);
    expect(screen.getByText(en.host)).toBeInTheDocument();
  });
});
