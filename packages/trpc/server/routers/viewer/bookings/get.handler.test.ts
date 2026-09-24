import getAllUserBookings from "@calcom/features/bookings/lib/getAllUserBookings";
import type { DB } from "@calcom/kysely";
import type { PrismaClient } from "@calcom/prisma";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBookings, getHandler } from "./get.handler";

vi.mock("@calcom/features/bookings/lib/getAllUserBookings");
vi.mock("@calcom/kysely", () => ({
  default: {
    selectFrom: vi.fn(),
    executeQuery: vi.fn(),
  },
}));
vi.mock("@calcom/lib/logger", () => ({
  default: {
    getSubLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe("getHandler", () => {
  const mockUser = {
    id: 1,
    email: "user@example.com",
    name: "Test User",
    profile: {
      organizationId: null,
    },
  };

  const mockPrisma = {} as unknown as PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return bookings successfully", async () => {
    const mockBookings = [
      {
        id: 1,
        uid: "booking-1",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        rescheduler: null,
        eventType: {
          recurringEvent: null,
          eventTypeColor: null,
          price: 0,
          currency: "usd",
          metadata: {},
        },
      },
    ] as any;

    vi.mocked(getAllUserBookings).mockResolvedValue({
      bookings: mockBookings,
      recurringInfo: [],
      totalCount: 1,
    });

    const result = await getHandler({
      ctx: {
        user: mockUser as any,
        prisma: mockPrisma,
      },
      input: {
        filters: {},
        limit: 10,
        offset: 0,
      },
    });

    expect(result.bookings).toEqual(mockBookings);
    expect(result.totalCount).toBe(1);
    expect(getAllUserBookings).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          user: expect.objectContaining({
            id: mockUser.id,
            email: mockUser.email,
            orgId: null,
          }),
        }),
        filters: {},
        take: 10,
        skip: 0,
        bookingListingByStatus: ["upcoming"],
      })
    );
  });
});

describe("getBookings - stub PermissionCheckService behavior", () => {
  const mockUser = {
    id: 1,
    email: "user@example.com",
    orgId: null,
  };

  const mockPrisma = {
    membership: {
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    eventType: {
      findMany: vi.fn(),
    },
    booking: {
      findUnique: vi.fn(),
      groupBy: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  } as unknown as PrismaClient;

  const createMockKysely = () => {
    const mockQueryBuilder = {
      select: vi.fn((arg?: unknown) => {
        if (typeof arg === "function") {
          return mockQueryBuilder;
        }
        return mockQueryBuilder;
      }),
      selectAll: vi.fn(() => mockQueryBuilder),
      where: vi.fn(() => mockQueryBuilder),
      innerJoin: vi.fn(() => mockQueryBuilder),
      union: vi.fn(() => mockQueryBuilder),
      unionAll: vi.fn(() => mockQueryBuilder),
      distinct: vi.fn(() => mockQueryBuilder),
      as: vi.fn(() => mockQueryBuilder),
      $if: vi.fn(() => mockQueryBuilder),
      orderBy: vi.fn(() => mockQueryBuilder),
      limit: vi.fn(() => mockQueryBuilder),
      offset: vi.fn(() => mockQueryBuilder),
      compile: vi.fn(() => ({ sql: "SELECT * FROM bookings" })),
      executeTakeFirst: vi.fn().mockResolvedValue({ bookingCount: 0 }),
      execute: vi.fn().mockResolvedValue([]),
    };

    return {
      selectFrom: vi.fn(() => mockQueryBuilder),
      executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
      _mockQueryBuilder: mockQueryBuilder,
    } as unknown as Kysely<DB> & { _mockQueryBuilder: typeof mockQueryBuilder };
  };

  let mockKysely: ReturnType<typeof createMockKysely>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKysely = createMockKysely();
  });

  it("should allow access when filtering by own userId", async () => {
    mockPrisma.user.findMany = vi.fn((args: { where?: { id?: { in?: number[] } } }) => {
      if (args?.where?.id?.in?.includes(1)) {
        return Promise.resolve([{ id: 1, email: "user@example.com" }]) as ReturnType<typeof mockPrisma.user.findMany>;
      }
      return Promise.resolve([]) as ReturnType<typeof mockPrisma.user.findMany>;
    });
    mockPrisma.eventType.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.booking.groupBy = vi.fn().mockResolvedValue([]);

    await expect(
      getBookings({
        user: mockUser,
        prisma: mockPrisma,
        kysely: mockKysely as unknown as Kysely<DB>,
        bookingListingByStatus: ["upcoming"],
        filters: {
          userIds: [1],
        },
        take: 10,
        skip: 0,
      })
    ).resolves.not.toThrow();
  });

  // Flowko: the userIds filter is authorised before any user lookup, so a foreign id gets the same
  // FORBIDDEN whether or not a user has it (it used to be BAD_REQUEST for a missing id: an existence oracle)
  it.each([
    ["an id no user has", [] as { id: number; email: string }[]],
    ["another tenant's existing id", [{ id: 4, email: "other-tenant@example.com" }]],
  ])("should throw FORBIDDEN without looking up users when filtering by %s", async (_label, users) => {
    mockPrisma.user.findMany = vi.fn().mockResolvedValue(users);
    mockPrisma.eventType.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.booking.groupBy = vi.fn().mockResolvedValue([]);

    await expect(
      getBookings({
        user: mockUser,
        prisma: mockPrisma,
        kysely: mockKysely as unknown as Kysely<DB>,
        bookingListingByStatus: ["upcoming"],
        filters: {
          userIds: [4],
        },
        take: 10,
        skip: 0,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "You do not have permissions to fetch bookings for specified userIds",
    });
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    expect(mockKysely.executeQuery).not.toHaveBeenCalled();
  });

  it("should throw FORBIDDEN when the userIds filter mixes the caller's own id with another", async () => {
    mockPrisma.user.findMany = vi.fn().mockResolvedValue([
      { id: 1, email: "user@example.com" },
      { id: 4, email: "other-tenant@example.com" },
    ]);
    mockPrisma.booking.groupBy = vi.fn().mockResolvedValue([]);

    await expect(
      getBookings({
        user: mockUser,
        prisma: mockPrisma,
        kysely: mockKysely as unknown as Kysely<DB>,
        bookingListingByStatus: ["upcoming"],
        filters: {
          userIds: [1, 4],
        },
        take: 10,
        skip: 0,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("should execute query via kysely when no userIds filter is provided", async () => {
    mockPrisma.user.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.eventType.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.booking.groupBy = vi.fn().mockResolvedValue([]);

    await getBookings({
      user: mockUser,
      prisma: mockPrisma,
      kysely: mockKysely as unknown as Kysely<DB>,
      bookingListingByStatus: ["upcoming"],
      filters: {},
      take: 10,
      skip: 0,
    });

    expect((mockKysely as unknown as { executeQuery: ReturnType<typeof vi.fn> }).executeQuery).toHaveBeenCalled();
  });

  it("should NOT fetch user IDs when no userIds filter is provided", async () => {
    mockPrisma.user.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.eventType.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.booking.groupBy = vi.fn().mockResolvedValue([]);

    await getBookings({
      user: mockUser,
      prisma: mockPrisma,
      kysely: mockKysely as unknown as Kysely<DB>,
      bookingListingByStatus: ["upcoming"],
      filters: {},
      take: 10,
      skip: 0,
    });

    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("should use unionAll for combining booking queries", async () => {
    mockPrisma.user.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.booking.groupBy = vi.fn().mockResolvedValue([]);

    await getBookings({
      user: mockUser,
      prisma: mockPrisma,
      kysely: mockKysely as unknown as Kysely<DB>,
      bookingListingByStatus: ["upcoming"],
      filters: {},
      take: 10,
      skip: 0,
    });

    expect(mockKysely._mockQueryBuilder.unionAll).toHaveBeenCalled();
  });

  it("should apply DISTINCT on the outer select", async () => {
    mockPrisma.user.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.booking.groupBy = vi.fn().mockResolvedValue([]);

    await getBookings({
      user: mockUser,
      prisma: mockPrisma,
      kysely: mockKysely as unknown as Kysely<DB>,
      bookingListingByStatus: ["upcoming"],
      filters: {},
      take: 10,
      skip: 0,
    });

    expect(mockKysely._mockQueryBuilder.distinct).toHaveBeenCalled();
  });
});

// Flowko: a row where the caller is only an attendee (they booked another tenant's page with their own
// account email) gets the booker's view, not the host-side record (BK-2)
describe("getBookings - booker view of rows the caller only attends", () => {
  const caller = { id: 1, email: "user@example.com", orgId: null };
  const hostEmail = "host@victim.si";

  const bookingRow = ({
    organizerId,
    hideOrganizerEmail,
  }: {
    organizerId: number;
    hideOrganizerEmail: boolean;
  }) => ({
    id: 10,
    title: "Consultation",
    userPrimaryEmail: "host-calendar@victim.si",
    description: null,
    customInputs: null,
    startTime: new Date("2030-01-01T10:00:00.000Z"),
    endTime: new Date("2030-01-01T10:30:00.000Z"),
    createdAt: new Date("2029-12-01T10:00:00.000Z"),
    updatedAt: new Date("2029-12-01T10:00:00.000Z"),
    metadata: {},
    uid: "booking-uid",
    responses: {},
    recurringEventId: null,
    location: "integrations:google:meet",
    status: "ACCEPTED",
    paid: false,
    fromReschedule: "previous-booking-uid",
    rescheduled: null,
    rescheduledBy: hostEmail,
    cancelledBy: hostEmail,
    isRecorded: false,
    cancellationReason: null,
    rejectionReason: null,
    eventType: {
      slug: "consultation",
      id: 5,
      title: "Consultation",
      eventName: null,
      price: 0,
      recurringEvent: null,
      currency: "usd",
      metadata: { apps: { giphy: { enabled: true, credentialId: 77, thankYouPage: "https://gif" } } },
      disableGuests: false,
      bookingFields: null,
      seatsPerTimeSlot: null,
      seatsShowAttendees: false,
      seatsShowAvailabilityCount: false,
      eventTypeColor: null,
      customReplyToEmail: null,
      allowReschedulingPastBookings: false,
      hideOrganizerEmail,
      disableCancelling: false,
      disableRescheduling: false,
      minimumRescheduleNotice: null,
      teamId: null,
      parentId: null,
      schedulingType: null,
      hosts: [{ userId: organizerId, user: { id: organizerId, email: hostEmail } }],
      length: 30,
      team: null,
      hostGroups: [],
    },
    references: [
      {
        id: 1,
        type: "google_calendar",
        uid: "google-event-id",
        meetingId: "meeting-id",
        thirdPartyRecurringEventId: null,
        meetingPassword: "meeting-password",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        bookingId: 10,
        externalCalendarId: "host.private@gmail.com",
        deleted: null,
        credentialId: 42,
        delegationCredentialId: null,
      },
      {
        id: 2,
        type: "google_calendar",
        uid: "old-google-event-id",
        meetingId: null,
        thirdPartyRecurringEventId: null,
        meetingPassword: null,
        meetingUrl: "https://meet.google.com/old",
        bookingId: 10,
        externalCalendarId: "host.private@gmail.com",
        deleted: true,
        credentialId: 42,
        delegationCredentialId: null,
      },
    ],
    payment: [],
    user: {
      id: organizerId,
      name: "Victim Host",
      email: hostEmail,
      avatarUrl: null,
      username: "victim",
      timeZone: "Europe/Ljubljana",
    },
    attendees: [
      {
        id: 100,
        email: "User@Example.com",
        name: "Booker",
        timeZone: "Europe/Ljubljana",
        phoneNumber: "+38640111111",
        locale: "sl",
        bookingId: 10,
        noShow: false,
      },
      {
        id: 101,
        email: "guest@example.org",
        name: "Guest",
        timeZone: "Europe/Ljubljana",
        phoneNumber: "+38640222222",
        locale: "sl",
        bookingId: 10,
        noShow: false,
      },
    ],
    seatsReferences: [],
    assignmentReasonSortedByCreatedAt: [{ id: 1, bookingId: 10, reasonEnum: "ROUTING_FORM_ROUTING" }],
    report: {
      id: "report-1",
      reportedById: organizerId,
      reason: "SPAM",
      description: "host's private note about the booker",
      createdAt: new Date("2029-12-02T10:00:00.000Z"),
    },
  });

  const createKyselyReturning = (rows: unknown[]) => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of [
      "select",
      "selectAll",
      "where",
      "innerJoin",
      "leftJoin",
      "unionAll",
      "distinct",
      "as",
      "$if",
      "orderBy",
      "limit",
      "offset",
    ]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.compile = vi.fn(() => ({ sql: "SELECT 1" }));
    builder.executeTakeFirst = vi.fn().mockResolvedValue({ bookingCount: rows.length });
    // First the booking rows, then the attendees' user data (none of them has an account here)
    builder.execute = vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    return {
      selectFrom: vi.fn(() => builder),
      executeQuery: vi.fn().mockResolvedValue({ rows: rows.map(() => ({ id: 10 })) }),
    } as unknown as Kysely<DB>;
  };

  const createPrisma = () =>
    ({
      user: { findMany: vi.fn().mockResolvedValue([]) },
      eventType: { findMany: vi.fn().mockResolvedValue([]) },
      booking: {
        findUnique: vi.fn().mockResolvedValue({ rescheduledBy: hostEmail }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    }) as unknown as PrismaClient & { booking: { findUnique: ReturnType<typeof vi.fn> } };

  const listFor = async (row: ReturnType<typeof bookingRow>, prisma = createPrisma()) => {
    const { bookings } = await getBookings({
      user: caller,
      prisma,
      kysely: createKyselyReturning([row]),
      bookingListingByStatus: ["upcoming"],
      filters: {},
      take: 10,
      skip: 0,
    });
    expect(bookings).toHaveLength(1);
    return bookings[0];
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the organizer's identity, calendar references, report and other people's phone numbers", async () => {
    const prisma = createPrisma();
    const booking = await listFor(bookingRow({ organizerId: 2, hideOrganizerEmail: true }), prisma);

    expect(booking.user).toEqual({
      name: "Victim Host",
      email: null,
      avatarUrl: null,
      username: "victim",
      timeZone: "Europe/Ljubljana",
    });
    expect(booking.user).not.toHaveProperty("id");
    expect(booking.userPrimaryEmail).toBeNull();
    // The host cancelled and rescheduled: the booker is shown their name, as the booking page does
    expect(booking.cancelledBy).toBe("Victim Host");
    expect(booking.rescheduledBy).toBe("Victim Host");
    expect(booking.rescheduler).toBe("Victim Host");
    expect(booking.references).toEqual([
      {
        type: "google_calendar",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        meetingPassword: "meeting-password",
      },
    ]);
    expect(booking.report).toBeNull();
    expect(booking.assignmentReasonSortedByCreatedAt).toEqual([]);
    expect(booking.eventType.hosts).toEqual([]);
    expect(booking.eventType.metadata?.apps).toEqual({
      giphy: { enabled: true, thankYouPage: "https://gif" },
    });
    // The caller's own attendee row keeps its phone number, matched case-insensitively
    expect(booking.attendees.map(({ email, phoneNumber }) => ({ email, phoneNumber }))).toEqual([
      { email: "User@Example.com", phoneNumber: "+38640111111" },
      { email: "guest@example.org", phoneNumber: null },
    ]);

    const serialised = JSON.stringify(booking);
    for (const secret of [
      hostEmail,
      "host-calendar@victim.si",
      "host.private@gmail.com",
      "google-event-id",
      "credentialId",
      "host's private note",
      "+38640222222",
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("keeps the caller's own email and drops a third party's as who cancelled or rescheduled", async () => {
    const prisma = createPrisma();
    prisma.booking.findUnique.mockResolvedValue({ rescheduledBy: "User@example.com" });
    const row = {
      ...bookingRow({ organizerId: 2, hideOrganizerEmail: true }),
      cancelledBy: "user@example.com",
      rescheduledBy: "someone@else.org",
    };
    const booking = await listFor(row, prisma);

    expect(booking.cancelledBy).toBe("user@example.com");
    expect(booking.rescheduledBy).toBeNull();
    expect(booking.rescheduler).toBe("User@example.com");
  });

  it("keeps the organizer's email for a booker when the event type doesn't hide it", async () => {
    const prisma = createPrisma();
    const booking = await listFor(bookingRow({ organizerId: 2, hideOrganizerEmail: false }), prisma);

    expect(booking.user).not.toHaveProperty("id");
    expect(booking.user?.email).toBe(hostEmail);
    expect(booking.userPrimaryEmail).toBe("host-calendar@victim.si");
    expect(booking.cancelledBy).toBe(hostEmail);
    expect(booking.rescheduledBy).toBe(hostEmail);
    expect(booking.rescheduler).toBe(hostEmail);
    expect(prisma.booking.findUnique).toHaveBeenCalledWith({
      where: { uid: "previous-booking-uid" },
      select: { rescheduledBy: true },
    });
    // Still a booker: no calendar ids, report, host ids or other people's phone numbers
    expect(booking.references).toHaveLength(1);
    expect(JSON.stringify(booking.references)).not.toContain("host.private@gmail.com");
    expect(booking.report).toBeNull();
    expect(booking.eventType.hosts).toEqual([]);
    expect(booking.attendees[1].phoneNumber).toBeNull();
  });

  // Hidden answers are what the booking page drops for anyone who isn't a host; phone answers are the booker's
  const bookerResponses = (bookerEmail: string) => ({
    name: "Booker X",
    email: bookerEmail,
    attendeePhoneNumber: "+38640333333",
    smsReminderNumber: "+38640444444",
    mobile: "+38640555555",
    secretField: "hidden-answer",
    notes: "see you",
    guests: ["user@example.com"],
  });
  const withResponses = (
    row: ReturnType<typeof bookingRow>,
    responses: Record<string, unknown>,
    bookingFields: Record<string, unknown>[]
  ) => ({ ...row, responses, eventType: { ...row.eventType, bookingFields } });

  it("drops hidden and phone answers from the responses of a booking the caller is a guest on", async () => {
    const base = bookingRow({ organizerId: 2, hideOrganizerEmail: false });
    const row = withResponses(
      {
        ...base,
        attendees: [
          { ...base.attendees[1], id: 102, email: "booker@example.org", phoneNumber: "+38640333333" },
          { ...base.attendees[0], phoneNumber: null },
        ],
      },
      bookerResponses("booker@example.org"),
      [
        { name: "secretField", type: "text", hidden: true },
        { name: "mobile", type: "phone" },
        // A stored system field without its own hidden flag keeps the default, which hides the phone number
        { name: "attendeePhoneNumber", type: "phone", required: false },
        { name: "notes", type: "textarea" },
      ]
    );
    const booking = await listFor(row);

    expect(booking.responses).toEqual({
      name: "Booker X",
      email: "booker@example.org",
      notes: "see you",
      guests: ["user@example.com"],
    });
    expect(booking.attendees.map(({ phoneNumber }) => phoneNumber)).toEqual([null, null]);
    const serialised = JSON.stringify(booking);
    for (const secret of ["+38640333333", "+38640444444", "+38640555555", "hidden-answer"]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("keeps the booker's own answers but not hidden ones", async () => {
    const row = withResponses(
      bookingRow({ organizerId: 2, hideOrganizerEmail: false }),
      bookerResponses("User@Example.com"),
      [
        { name: "secretField", type: "text", hidden: true },
        { name: "mobile", type: "phone" },
        { name: "attendeePhoneNumber", type: "phone", hidden: false },
        { name: "smsReminderNumber", type: "phone", hidden: false },
      ]
    );
    const booking = await listFor(row);

    expect(booking.responses).toEqual({
      name: "Booker X",
      email: "User@Example.com",
      attendeePhoneNumber: "+38640333333",
      smsReminderNumber: "+38640444444",
      mobile: "+38640555555",
      notes: "see you",
      guests: ["user@example.com"],
    });
  });

  it("drops a system field's answer that its default hides when the event type never saved the field", async () => {
    const base = bookingRow({ organizerId: 2, hideOrganizerEmail: false });
    const row = withResponses(
      { ...base, eventType: { ...base.eventType, disableGuests: true } },
      { ...bookerResponses("User@Example.com"), title: "prefilled title" },
      []
    );
    const booking = await listFor(row);

    expect(booking.responses).toEqual({
      name: "Booker X",
      email: "User@Example.com",
      smsReminderNumber: "+38640444444",
      mobile: "+38640555555",
      secretField: "hidden-answer",
      notes: "see you",
    });
  });

  it("drops an attendee row under a host's email when the event type hides the organizer's email", async () => {
    const base = bookingRow({ organizerId: 2, hideOrganizerEmail: true });
    const hostAsGuest = { ...base.attendees[1], id: 103, email: "Host@Victim.si", phoneNumber: null };
    const booking = await listFor({ ...base, attendees: [...base.attendees, hostAsGuest] });

    expect(booking.attendees.map(({ email }) => email)).toEqual(["User@Example.com", "guest@example.org"]);
    expect(JSON.stringify(booking)).not.toContain("Host@Victim.si");

    const shown = bookingRow({ organizerId: 2, hideOrganizerEmail: false });
    const bookingShown = await listFor({ ...shown, attendees: [...shown.attendees, hostAsGuest] });
    expect(bookingShown.attendees.map(({ email }) => email)).toEqual([
      "User@Example.com",
      "guest@example.org",
      "Host@Victim.si",
    ]);
  });

  it("gives the booker's view to a Host row's user who doesn't organize the booking", async () => {
    const base = bookingRow({ organizerId: 2, hideOrganizerEmail: true });
    const row = {
      ...base,
      eventType: {
        ...base.eventType,
        // The caller is among the attendees under this exact email, as checkIfUserIsHost requires
        hosts: [
          ...base.eventType.hosts,
          { userId: caller.id, user: { id: caller.id, email: "User@Example.com" } },
        ],
      },
    };
    const booking = await listFor(row);

    expect(booking.user).not.toHaveProperty("id");
    expect(booking.references).toHaveLength(1);
    expect(booking.report).toBeNull();
    expect(booking.eventType.hosts).toEqual([]);
    expect(JSON.stringify(booking)).not.toContain("host.private@gmail.com");
  });

  it("returns every answer on a row the caller organizes", async () => {
    const responses = bookerResponses("booker@example.org");
    const row = withResponses(bookingRow({ organizerId: caller.id, hideOrganizerEmail: true }), responses, [
      { name: "secretField", type: "text", hidden: true },
      { name: "mobile", type: "phone" },
    ]);
    const booking = await listFor(row);

    expect(booking.responses).toEqual(responses);
  });

  it("returns the full record on a row the caller organizes", async () => {
    const row = bookingRow({ organizerId: caller.id, hideOrganizerEmail: true });
    const booking = await listFor(row);

    expect(booking.user).toEqual(row.user);
    expect(booking.userPrimaryEmail).toBe("host-calendar@victim.si");
    expect(booking.cancelledBy).toBe(hostEmail);
    expect(booking.rescheduler).toBe(hostEmail);
    expect(booking.references).toEqual(row.references);
    expect(booking.report).toEqual(row.report);
    expect(booking.assignmentReasonSortedByCreatedAt).toEqual(row.assignmentReasonSortedByCreatedAt);
    expect(booking.eventType.hosts).toEqual(row.eventType.hosts);
    expect(booking.eventType.metadata?.apps).toEqual(row.eventType.metadata.apps);
    expect(booking.attendees.map(({ phoneNumber }) => phoneNumber)).toEqual(["+38640111111", "+38640222222"]);
  });
});
