/**
 * U14 Task 6: the handler tells the e-mail senders what a booker's title is built from, so the booker's copy can
 * be rebuilt in the booker's language. The host's mails keep the stored title (recipient-language.test.ts).
 */
import type { CalendarEvent } from "@calcom/types/Calendar";
import { beforeEach, describe, expect, it, vi } from "vitest";

const senders = vi.hoisted(() => ({
  sendRescheduledEmailsAndSMS: vi.fn(),
  sendOrganizerRequestEmail: vi.fn(),
  sendAttendeeRequestEmailAndSMS: vi.fn(),
  sendAddGuestsEmailsAndSMS: vi.fn(),
  sendScheduledEmailsAndSMS: vi.fn(),
}));
vi.mock("@calcom/emails/email-manager", () => senders);

import { BookingActionMap, BookingEmailSmsHandler } from "./BookingEmailSmsHandler";

const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
const handler = new BookingEmailSmsHandler({
  logger: { ...logger, getSubLogger: () => logger } as never,
});
const evt = { attendees: [{ email: "booker@example.com" }] } as unknown as CalendarEvent;
const eventType = { metadata: {}, schedulingType: null, title: "Ogled", eventName: null };
const TITLE_SOURCE = { eventType: "Ogled", eventName: null };

describe("BookingEmailSmsHandler title source", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rescheduled", async () => {
    await handler.send({
      action: BookingActionMap.rescheduled,
      data: { evt, eventType, additionalInformation: {}, additionalNotes: null } as never,
    });
    expect(senders.sendRescheduledEmailsAndSMS).toHaveBeenCalledWith(expect.anything(), {}, TITLE_SOURCE);
  });

  it("requested", async () => {
    await handler.send({
      action: BookingActionMap.requested,
      data: { evt, eventType, attendees: evt.attendees, additionalNotes: null },
    });
    expect(senders.sendAttendeeRequestEmailAndSMS).toHaveBeenCalledWith(
      expect.anything(),
      evt.attendees[0],
      {},
      TITLE_SOURCE
    );
    expect(senders.sendOrganizerRequestEmail).toHaveBeenCalledWith(expect.anything(), {});
  });

  it.each(["handleAddGuests", "handleAddAttendee"] as const)("%s", async (method) => {
    await handler[method]({ evt, eventType, newGuests: ["guest@example.com"] });
    expect(senders.sendAddGuestsEmailsAndSMS).toHaveBeenCalledWith({
      calEvent: evt,
      newGuests: ["guest@example.com"],
      eventTypeMetadata: {},
      titleSource: TITLE_SOURCE,
    });
  });

  it("a payload without the event type's name fields gives an unknown template, so the stored title stays", async () => {
    await handler.handleAddGuests({
      evt,
      eventType: { metadata: {}, schedulingType: null },
      newGuests: [],
    });
    expect(senders.sendAddGuestsEmailsAndSMS).toHaveBeenCalledWith(
      expect.objectContaining({ titleSource: { eventType: undefined, eventName: undefined } })
    );
  });
});
