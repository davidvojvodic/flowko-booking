// Flowko U27: the bookings list never shows a desk-only organizer's placeholder address (desk-<uuid>@flowko.invalid)
// as a mailto link; an ordinary organizer is unchanged.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FirstAttendee } from "./BookingListItem";

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "sl" } }),
}));

describe("FirstAttendee (U27)", () => {
  it("renders a desk-only organizer by name, without a mailto link", () => {
    const { container } = render(
      <FirstAttendee
        user={{ id: 1, name: "Marija Novak", email: "desk-x@flowko.invalid" }}
        currentEmail="owner@example.com"
        hideOrganizerEmail={false}
      />
    );
    expect(screen.getByText("Marija Novak")).toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).not.toContain("mailto:");
    expect(container.innerHTML).not.toContain("flowko.invalid");
  });

  it("renders an ordinary organizer as a mailto link, as before", () => {
    const { container } = render(
      <FirstAttendee
        user={{ id: 2, name: "Ana", email: "ana@example.com" }}
        currentEmail="owner@example.com"
        hideOrganizerEmail={false}
      />
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("mailto:ana@example.com");
  });

  it("still hides an ordinary organizer's address when the event type asks for it", () => {
    const { container } = render(
      <FirstAttendee
        user={{ id: 2, name: "Ana", email: "ana@example.com" }}
        currentEmail="owner@example.com"
        hideOrganizerEmail
      />
    );
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("Ana")).toBeInTheDocument();
  });
});
