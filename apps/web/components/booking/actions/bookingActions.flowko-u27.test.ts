// Flowko U27: a salon (mirror) booking row keeps Cal's cancel, but loses reschedule, reschedule request, edit
// location, additional guests and report; a row without the mirror flag is unchanged.
import { describe, expect, it } from "vitest";

import { BookingStatus, SchedulingType } from "@calcom/prisma/enums";

import {
  getAfterEventActions,
  getCancelEventAction,
  getEditEventActions,
  getPendingActions,
  isFlowkoMirrorBooking,
  shouldShowEditActions,
  shouldShowIndividualReportButton,
  shouldShowReportAction,
  type BookingActionContext,
} from "./bookingActions";

function context(metadata: unknown, overrides: Partial<BookingActionContext> = {}): BookingActionContext {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
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
    isUpcoming: true,
    isOngoing: false,
    isBookingInPast: false,
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
    ...overrides,
  } as unknown as BookingActionContext;
}

const ids = (actions: { id: string }[]): string[] => actions.map((action) => action.id);

describe("salon (mirror) booking actions (U27)", () => {
  it("recognises the mirror flag and nothing else", () => {
    expect(isFlowkoMirrorBooking(context({ flowkoMirror: true }).booking)).toBe(true);
    expect(isFlowkoMirrorBooking(context({}).booking)).toBe(false);
    expect(isFlowkoMirrorBooking(context(null).booking)).toBe(false);
    expect(isFlowkoMirrorBooking(context(undefined).booking)).toBe(false);
    expect(isFlowkoMirrorBooking(context({ flowkoMirror: false }).booking)).toBe(false);
  });

  it("offers no reschedule, reschedule request, location or guests action on a mirror row", () => {
    const mirror = context({ flowkoMirror: true });
    expect(ids(getEditEventActions(mirror))).toEqual([]);
  });

  it("hides the report action on a mirror row, in the menu and as the single button", () => {
    const mirror = context({ flowkoMirror: true }, { isCancelled: true });
    expect(shouldShowReportAction(mirror)).toBe(false);
    expect(shouldShowIndividualReportButton(mirror)).toBe(false);
  });

  it("keeps cancel, enabled, on a mirror row", () => {
    const cancel = getCancelEventAction(context({ flowkoMirror: true }));
    expect(cancel.id).toBe("cancel");
    expect(cancel.disabled).toBe(false);
  });

  it("leaves confirm/reject as Cal decides on a mirror row (no-show: see the U28 test)", () => {
    const mirror = context({ flowkoMirror: true }, { isPending: true });
    expect(ids(getPendingActions(mirror))).toEqual(["confirm", "reject"]);
    // Flowko U28 (D4): the no_show action is gone on a mirror row
    expect(ids(getAfterEventActions(mirror))).not.toContain("no_show");
  });

  it("leaves an ordinary row unchanged", () => {
    const ordinary = context({});
    expect(ids(getEditEventActions(ordinary))).toEqual(["reschedule", "reschedule_request", "change_location", "add_members"]);
    expect(shouldShowReportAction(ordinary)).toBe(true);
    expect(shouldShowIndividualReportButton(context({}, { isCancelled: true }))).toBe(true);
    expect(shouldShowEditActions(ordinary)).toBe(true);
  });
});
