/**
 * Flowko (B1 follow-up): a booking that waited for the host's confirmation (or for payment) may store a
 * location whose app the admin has switched off: one an anonymous booker sent before the booker's location was
 * checked, or an app switched off after the booking was made. Confirming it must not run that app (a Google
 * Meet link on the tenant's calendar, a Daily room while Cal Video is off); the booking then has no location,
 * as a new booking of a switched-off app's location does.
 */
import { prisma } from "@calcom/prisma/__mocks__/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import type { CalendarEvent } from "@calcom/types/Calendar";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { eventManagerCreate } = vi.hoisted(() => ({ eventManagerCreate: vi.fn() }));

vi.mock("@calcom/features/bookings/lib/EventManager", () => ({
  default: class {
    create = eventManagerCreate;
  },
}));
vi.mock("@calcom/emails/email-manager", () => ({ sendScheduledEmailsAndSMS: vi.fn() }));
vi.mock("@calcom/features/webhooks/lib/getWebhooks", () => ({ default: vi.fn().mockResolvedValue([]) }));
vi.mock("@calcom/features/webhooks/lib/scheduleTrigger", () => ({ scheduleTrigger: vi.fn() }));
vi.mock("@calcom/features/webhooks/lib/sendOrSchedulePayload", () => ({ default: vi.fn() }));
vi.mock("./handleNewBooking/scheduleNoShowTriggers", () => ({ scheduleNoShowTriggers: vi.fn() }));
vi.mock("./getCalEventResponses", () => ({ getCalEventResponses: vi.fn().mockReturnValue({}) }));
vi.mock("@calcom/lib/tracing/factory", () => ({
  distributedTracing: {
    createSpan: vi.fn(),
    getTracingLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
  },
}));

import { handleConfirmation } from "./handleConfirmation";
import { scheduleNoShowTriggers } from "./handleNewBooking/scheduleNoShowTriggers";

type AppWhere = { enabled: true; OR: [{ dirName: { in: string[] } }, { slug: { in: string[] } }] };

const appRows = [
  { slug: "google-calendar", dirName: "googlecalendar" },
  { slug: "google-meet", dirName: "googlevideo" },
  { slug: "daily-video", dirName: "dailyvideo" },
];

// An App table in which only the given apps are enabled (the instance keeps every app off by default)
function withEnabledApps(...enabledSlugs: string[]) {
  prisma.app.findMany.mockImplementation((async ({ where }: { where: AppWhere }) =>
    appRows.filter(
      (app) =>
        enabledSlugs.includes(app.slug) &&
        (where.OR[0].dirName.in.includes(app.dirName) || where.OR[1].slug.in.includes(app.slug))
    )) as never);
}

const CONFERENCE_CREDENTIAL_ID = 7;

async function confirmBookingWithLocation(location: string | null, evtLocation: string | null = location) {
  const evt = {
    type: "30min",
    title: "Meeting",
    uid: "booking-uid",
    startTime: "2026-10-01T10:00:00.000Z",
    endTime: "2026-10-01T10:30:00.000Z",
    organizer: {
      id: 101,
      email: "host@example.com",
      name: "Host",
      timeZone: "UTC",
      language: { locale: "en", translate: (key: string) => key },
    },
    attendees: [],
    location: evtLocation,
    conferenceCredentialId: CONFERENCE_CREDENTIAL_ID,
    destinationCalendar: [],
  } as unknown as CalendarEvent;

  await handleConfirmation({
    user: { id: 101, email: "host@example.com", credentials: [], destinationCalendar: null, username: "host" },
    evt,
    prisma,
    bookingId: 1,
    booking: {
      startTime: new Date("2026-10-01T10:00:00.000Z"),
      id: 1,
      uid: "booking-uid",
      eventType: {
        currency: "usd",
        description: null,
        id: 1,
        length: 30,
        price: 0,
        requiresConfirmation: true,
        metadata: {},
        title: "Meeting",
      },
      metadata: {},
      eventTypeId: 1,
      smsReminderNumber: null,
      userId: 101,
      location,
      status: BookingStatus.PENDING,
    },
    traceContext: { traceId: "trace", spanId: "span", operation: "test" },
  } as unknown as Parameters<typeof handleConfirmation>[0]);

  const [createdEvent] = eventManagerCreate.mock.calls[0] as [CalendarEvent];
  const updateData = prisma.booking.update.mock.calls[0][0].data;
  const noShowBooking = vi.mocked(scheduleNoShowTriggers).mock.calls[0][0].booking;
  return { evt, createdEvent, updateData, noShowBooking };
}

describe("handleConfirmation with a switched-off app's location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventManagerCreate.mockResolvedValue({ results: [], referencesToCreate: [] });
    prisma.booking.update.mockResolvedValue({ id: 1, eventType: null } as never);
  });

  it("confirms a stored Google Meet location with no location while Google Meet is disabled", async () => {
    withEnabledApps("google-calendar");

    const { evt, createdEvent, updateData, noShowBooking } =
      await confirmBookingWithLocation("integrations:google:meet");

    expect(createdEvent.location).toBe("");
    expect(createdEvent.conferenceCredentialId).toBeUndefined();
    expect(updateData.status).toBe(BookingStatus.ACCEPTED);
    expect(updateData.location).toBe("");
    expect(noShowBooking.location).toBe("");
    // The caller's event is left as it was
    expect(evt.location).toBe("integrations:google:meet");
  });

  it("confirms a stored Cal Video location with no location while Cal Video is disabled", async () => {
    withEnabledApps("google-calendar");

    const { createdEvent, updateData } = await confirmBookingWithLocation("integrations:daily");

    expect(createdEvent.location).toBe("");
    expect(createdEvent.conferenceCredentialId).toBeUndefined();
    expect(updateData.location).toBe("");
  });

  it("confirms an integrations:* location no app claims with no location", async () => {
    withEnabledApps("google-calendar", "daily-video");

    const { createdEvent, updateData } = await confirmBookingWithLocation("integrations:dailyx");

    expect(createdEvent.location).toBe("");
    expect(updateData.location).toBe("");
  });

  it("checks the location EventManager runs even when the booking stores none", async () => {
    withEnabledApps("google-calendar");

    const { createdEvent, updateData } = await confirmBookingWithLocation(null, "integrations:google:meet");

    expect(createdEvent.location).toBe("");
    expect(updateData.location).toBe("");
  });

  it("keeps a Cal Video location while Cal Video is enabled", async () => {
    withEnabledApps("google-calendar", "daily-video");

    const { createdEvent, updateData, noShowBooking } = await confirmBookingWithLocation("integrations:daily");

    expect(createdEvent.location).toBe("integrations:daily");
    expect(createdEvent.conferenceCredentialId).toBe(CONFERENCE_CREDENTIAL_ID);
    expect(updateData).not.toHaveProperty("location");
    expect(noShowBooking.location).toBe("integrations:daily");
  });

  it("keeps a Google Meet location while Google Meet is enabled", async () => {
    withEnabledApps("google-calendar", "google-meet");

    const { createdEvent, updateData } = await confirmBookingWithLocation("integrations:google:meet");

    expect(createdEvent.location).toBe("integrations:google:meet");
    expect(updateData).not.toHaveProperty("location");
  });

  it("keeps a location that belongs to no app without asking the App table", async () => {
    withEnabledApps();

    const { createdEvent, updateData } = await confirmBookingWithLocation("Prešernov trg 1, Ljubljana");

    expect(createdEvent.location).toBe("Prešernov trg 1, Ljubljana");
    expect(updateData).not.toHaveProperty("location");
    expect(prisma.app.findMany).not.toHaveBeenCalled();
  });
});
