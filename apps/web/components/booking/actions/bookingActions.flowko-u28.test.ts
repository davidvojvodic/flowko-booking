// Flowko U28 (D4): Cal's no-show controls are gone on a salon (mirror) row (the desk owns the business no-show);
// an ordinary row keeps them.
import { describe, expect, it } from "vitest";

import { BookingStatus, SchedulingType } from "@calcom/prisma/enums";

import {
  getAfterEventActions,
  shouldShowAttendeeNoShow,
  shouldShowNoShowAction,
  type BookingActionContext,
} from "./bookingActions";

function context(metadata: unknown): BookingActionContext {
  const start = new Date(Date.now() - 48 * 60 * 60 * 1000);
  return {
    booking: {
      id: 1,
      uid: "booking-1",
      status: BookingStatus.ACCEPTED,
      paid: false,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 3600000).toISOString(),
      seatsReferences: [],
      payment: [],
      report: null,
      user: { id: 7 },
      loggedInUser: { userId: 7 },
      eventType: {
        id: 1,
        schedulingType: SchedulingType.COLLECTIVE,
        parentId: null,
        disableGuests: false,
        allowReschedulingPastBookings: false,
        metadata,
      },
    },
    isUpcoming: false,
    isOngoing: false,
    isBookingInPast: true,
    isCancelled: false,
    isConfirmed: true,
    isRejected: false,
    isPending: false,
    isRescheduled: false,
    isRecurring: false,
    isTabRecurring: false,
    isTabUnconfirmed: false,
    isDisabledCancelling: false,
    isDisabledRescheduling: false,
    isCalVideoLocation: false,
    showPendingPayment: false,
    isAttendee: false,
    cardCharged: false,
    attendeeList: [{ name: "A", email: "a@example.com", id: 1, noShow: false, phoneNumber: null }],
    getSeatReferenceUid: () => undefined,
    t: (key: string) => key,
  } as unknown as BookingActionContext;
}

const ids = (actions: { id: string }[]): string[] => actions.map((action) => action.id);

describe("Cal no-show controls and salon (mirror) rows (U28)", () => {
  it("a past mirror row has no no_show after-event action", () => {
    const mirror = context({ flowkoMirror: true });
    expect(shouldShowNoShowAction(mirror)).toBe(false);
    expect(ids(getAfterEventActions(mirror))).not.toContain("no_show");
  });

  it("a past ordinary row keeps the no_show action", () => {
    for (const metadata of [{}, null, undefined, { flowkoMirror: false }]) {
      const ordinary = context(metadata);
      expect(shouldShowNoShowAction(ordinary)).toBe(true);
      expect(ids(getAfterEventActions(ordinary))).toContain("no_show");
    }
  });

  it("the attendee no-show toggle is off on a mirror row, and follows isBookingInPast on an ordinary row", () => {
    const mirror = context({ flowkoMirror: true }).booking;
    const ordinary = context({}).booking;
    expect(shouldShowAttendeeNoShow(mirror, true)).toBe(false);
    expect(shouldShowAttendeeNoShow(mirror, false)).toBe(false);
    expect(shouldShowAttendeeNoShow(ordinary, true)).toBe(true);
    expect(shouldShowAttendeeNoShow(ordinary, false)).toBe(false);
  });
});
