import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import CancelBooking from "../CancelBooking";

const { fire } = vi.hoisted(() => ({ fire: vi.fn() }));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  sdkActionManager: { fire },
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("@calcom/lib/hooks/useRefreshData", () => ({
  useRefreshData: () => vi.fn(),
}));

vi.mock("@calcom/features/bookings/lib/payment/shouldChargeNoShowCancellationFee", () => ({
  shouldChargeNoShowCancellationFee: vi.fn(() => false),
}));

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  // jsdom doesn't implement scrollIntoView, which the reason field calls on mount
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

afterEach(() => {
  cleanup();
});

// Flowko: since U13-11 the cancel form only runs first-party (booking.flowko.si in its own tab), so it asks for the
// default SameSite=Lax calcom.csrf_token cookie instead of upstream's SameSite=None
describe("CancelBooking CSRF token", () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    fire.mockReset();
  });

  function renderCancelBooking() {
    render(
      <CancelBooking
        booking={{ uid: "booking-uid", title: "Pregled", id: 1, startTime: new Date("2026-10-01T09:00:00Z") }}
        profile={{ name: "Salon", slug: "salon" }}
        team={null}
        isHost={false}
        recurringEvent={null}
        setIsCancellationMode={vi.fn()}
        theme="light"
        allRemainingBookings={false}
        currentUserEmail="ana@example.com"
        bookingCancelledEventProps={{
          booking: { uid: "booking-uid", startTime: "2026-10-01T09:00:00.000Z" },
          organizer: { name: "Salon", email: "organizer@example.com", timeZone: "Europe/Ljubljana" },
          eventType: { id: 5, slug: "pregled" },
        }}
        internalNotePresets={[]}
        renderContext="booking-single-view"
      />
    );
  }

  it("asks for the default (Lax) cookie and sends its token with the cancel request", async () => {
    fetchMock.mockResponses([JSON.stringify({ csrfToken: "token-from-cookie-route" }), { status: 200 }], [
      JSON.stringify({ success: true }),
      { status: 200 },
    ]);
    renderCancelBooking();

    fireEvent.click(screen.getByTestId("confirm_cancel"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/csrf");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/cancel");
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
      uid: "booking-uid",
      csrfToken: "token-from-cookie-route",
    });
    await waitFor(() => expect(fire).toHaveBeenCalledWith("bookingCancelled", expect.any(Object)));
  });
});
