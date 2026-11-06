import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Flowko U22: the reminder sweep. Prismock ignores unique keys, so the claim table is a hand mock that enforces
// @@unique([bookingId, offsetMinutes]) with a Set: that is what makes "never twice" testable (Review Focus 1).

const db = vi.hoisted(() => {
  const claims = new Set<string>();
  const state = {
    bookings: [] as unknown[],
    /** Bookings deleted after the select: claiming them violates the foreign key. */
    deleted: new Set<number>(),
  };
  const key = (bookingId: number, offsetMinutes: number) => `${bookingId}:${offsetMinutes}`;
  const prisma = {
    booking: {
      findMany: vi.fn(async (_args?: unknown) => state.bookings),
    },
    flowkoAttendeeReminder: {
      createMany: vi.fn(
        async ({
          data,
        }: {
          data: { bookingId: number; offsetMinutes: number }[];
          skipDuplicates?: boolean;
        }) => {
          let count = 0;
          for (const row of data) {
            if (state.deleted.has(row.bookingId)) {
              throw Object.assign(
                new Error(
                  `Foreign key constraint violated for booking uid-${row.bookingId} (booker@example.com)`
                ),
                { name: "PrismaClientKnownRequestError", code: "P2003" }
              );
            }
            const k = key(row.bookingId, row.offsetMinutes);
            if (!claims.has(k)) {
              claims.add(k);
              count++;
            }
          }
          return { count };
        }
      ),
      deleteMany: vi.fn(async ({ where }: { where: { bookingId: number; offsetMinutes: number } }) => ({
        count: claims.delete(key(where.bookingId, where.offsetMinutes)) ? 1 : 0,
      })),
    },
  };
  return { claims, state, prisma, key };
});

const mocks = vi.hoisted(() => ({
  emailsOff: vi.fn(async () => false),
  getBookingForCalEventBuilder: vi.fn(),
  fromBooking: vi.fn(),
  send: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@calcom/prisma", () => ({ default: db.prisma, prisma: db.prisma }));

vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir:
    (handler: (req: NextRequest) => Promise<Response>) =>
    (req: NextRequest, _context: { params: Promise<Record<string, string>> }) =>
      handler(req),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body })),
  },
}));

vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally = mocks.emailsOff;
  },
}));

vi.mock("@calcom/features/bookings/repositories/BookingRepository", () => ({
  BookingRepository: class {
    getBookingForCalEventBuilder = mocks.getBookingForCalEventBuilder;
  },
}));

vi.mock("@calcom/features/CalendarEventBuilder", () => ({
  CalendarEventBuilder: { fromBooking: mocks.fromBooking },
}));

vi.mock("@calcom/emails/email-manager", () => ({
  sendAttendeeReminderEmail: mocks.send,
}));

vi.mock("@calcom/lib/logger", () => ({
  default: { getSubLogger: () => mocks.log },
}));

import { MailTransportError } from "@calcom/emails/templates/_base-email";
import * as routeModule from "../route";
import { POST } from "../route";

const SECRET = "r".repeat(40);
const MIN = 60_000;
const START = new Date("2026-11-20T10:00:00.000Z");
const NOW = new Date(START.getTime() - 1440 * MIN + 5 * MIN); // 5 minutes after the 24 h reminder moment
const LONG_AGO = new Date("2026-11-01T08:00:00.000Z");

type Row = {
  id: number;
  startTime: Date;
  createdAt: Date;
  updatedAt: Date | null;
  responses: unknown;
  eventType: { id: number; title: string; eventName: string | null; metadata: unknown };
  attendees: { id: number; email: string; name: string; timeZone: string; locale: string | null }[];
};

const GUEST = { email: "guest@example.com", name: "Gost Guest", timeZone: "Europe/Ljubljana", locale: "sl" };
const BOOKER = {
  email: "Booker@Example.com",
  name: "Bara Booker",
  timeZone: "Europe/Ljubljana",
  locale: "sl",
};

const row = (id: number, overrides: Partial<Row> = {}): Row => ({
  id,
  startTime: START,
  createdAt: LONG_AGO,
  updatedAt: null,
  responses: { email: "booker@example.com", name: BOOKER.name },
  eventType: {
    id: 50,
    title: "Ogled stanovanja",
    eventName: null,
    metadata: { flowkoReminders: { enabled: true, offsets: [1440, 120] }, bookerLayouts: null },
  },
  // The guest has the lower id: the booker is found through responses.email, not by position.
  attendees: [
    { id: id * 10 + 1, ...GUEST },
    { id: id * 10 + 2, ...BOOKER },
  ],
  ...overrides,
});

/** What getBookingForCalEventBuilder returns, in DB order (guest first, no orderBy). */
const fullBooking = (id: number, status = "ACCEPTED") => ({
  id,
  uid: `uid-${id}`,
  status,
  attendees: [GUEST, BOOKER],
});

/** A built CalendarEvent: Person objects carry no id; type is the slug until the route overwrites it. */
const builtEvent = (booking: ReturnType<typeof fullBooking>) => ({
  title: "Ogled stanovanja med Gost Guest in Hana",
  type: "ogled-stanovanja",
  startTime: START.toISOString(),
  endTime: new Date(START.getTime() + 30 * MIN).toISOString(),
  bookerUrl: "https://booking.flowko.si",
  uid: booking.uid,
  organizer: { name: "Hana", email: "hana@example.com", timeZone: "Europe/Ljubljana" },
  attendees: booking.attendees.map((a) => ({
    name: a.name,
    email: a.email,
    timeZone: a.timeZone,
    language: { translate: (k: string) => k, locale: a.locale ?? "en" },
  })),
});

const request = (opts: { authorization?: string; query?: string } = {}) =>
  ({
    headers: new Headers(opts.authorization === undefined ? {} : { authorization: opts.authorization }),
    nextUrl: new URL(`http://localhost/api/cron/attendeeReminder${opts.query ?? ""}`),
  }) as unknown as NextRequest;

const authorized = () => request({ authorization: `Bearer ${SECRET}` });

const run = async (req = authorized()) =>
  (await POST(req, { params: Promise.resolve({}) })) as unknown as { status: number; body: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("FLOWKO_REMINDER_CRON_SECRET", SECRET);
  db.claims.clear();
  db.state.bookings = [];
  db.state.deleted.clear();
  mocks.emailsOff.mockResolvedValue(false);
  mocks.getBookingForCalEventBuilder.mockImplementation(async (id: number) => fullBooking(id));
  mocks.fromBooking.mockImplementation(async (booking: ReturnType<typeof fullBooking>) => ({
    build: () => builtEvent(booking),
  }));
  mocks.send.mockResolvedValue("sent");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/cron/attendeeReminder — auth (fails closed)", () => {
  const expectUnauthorized = async (req: NextRequest) => {
    const res = await run(req);
    expect(res.status).toBe(401);
    expect(mocks.emailsOff).not.toHaveBeenCalled();
    expect(db.prisma.booking.findMany).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  };

  it("401 without an Authorization header", async () => {
    await expectUnauthorized(request());
  });

  it("401 for a wrong Bearer token", async () => {
    await expectUnauthorized(request({ authorization: `Bearer ${"w".repeat(40)}` }));
  });

  it("401 for the raw secret without Bearer, and for ?apiKey=", async () => {
    await expectUnauthorized(request({ authorization: SECRET }));
    await expectUnauthorized(request({ query: `?apiKey=${SECRET}` }));
  });

  it("401 when the secret is unset or short, whatever the header says", async () => {
    vi.stubEnv("FLOWKO_REMINDER_CRON_SECRET", "");
    await expectUnauthorized(request({ authorization: "Bearer " }));
    await expectUnauthorized(request({ authorization: "Bearer undefined" }));
    vi.stubEnv("FLOWKO_REMINDER_CRON_SECRET", "short-secret");
    await expectUnauthorized(request({ authorization: "Bearer short-secret" }));
  });

  it("exports POST only (GET is a 405 from Next)", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["POST"]);
  });
});

describe("POST /api/cron/attendeeReminder — sweep", () => {
  it("does nothing while the global e-mail kill switch is on", async () => {
    mocks.emailsOff.mockResolvedValue(true);
    db.state.bookings = [row(1)];

    const res = await run();

    expect(res).toEqual({ status: 200, body: { skipped: "emails-off" } });
    expect(mocks.emailsOff).toHaveBeenCalledWith("emails");
    expect(db.prisma.booking.findMany).not.toHaveBeenCalled();
    expect(db.prisma.flowkoAttendeeReminder.createMany).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("selects only ACCEPTED, not-yet-claimed bookings in one narrow window per offset", async () => {
    await run();

    expect(db.prisma.booking.findMany).toHaveBeenCalledTimes(1);
    const args = db.prisma.booking.findMany.mock.calls[0][0] as unknown as Record<string, unknown>;
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);
    expect(args.where).toEqual({
      status: "ACCEPTED",
      endTime: { gt: NOW },
      eventTypeId: { not: null },
      eventType: { metadata: { path: ["flowkoReminders", "enabled"], equals: true } },
      OR: [
        {
          startTime: { gt: at(1440 - 60), lte: at(1440) },
          flowkoAttendeeReminders: { none: { offsetMinutes: 1440 } },
        },
        {
          startTime: { gt: at(120 - 60), lte: at(120) },
          flowkoAttendeeReminders: { none: { offsetMinutes: 120 } },
        },
      ],
    });
    expect(args.orderBy).toEqual({ startTime: "asc" });
    expect(args.take).toBe(200);
    expect(args.select).toEqual({
      id: true,
      startTime: true,
      createdAt: true,
      updatedAt: true,
      responses: true,
      eventType: { select: { id: true, title: true, eventName: true, metadata: true } },
      attendees: {
        select: { id: true, email: true, name: true, timeZone: true, locale: true },
        orderBy: { id: "asc" },
      },
    });
  });

  it("one due booking: claims it, sends one reminder to the booker only", async () => {
    db.state.bookings = [row(1)];

    const res = await run();

    expect(res).toEqual({ status: 200, body: { due: 1, sent: 1, failed: 0, skipped: 0 } });
    expect(db.prisma.flowkoAttendeeReminder.createMany).toHaveBeenCalledWith({
      data: [{ bookingId: 1, offsetMinutes: 1440 }],
      skipDuplicates: true,
    });
    expect(Array.from(db.claims)).toEqual(["1:1440"]);
    expect(mocks.getBookingForCalEventBuilder).toHaveBeenCalledWith(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);

    const [calEvent, booker, titleSource, metadata] = mocks.send.mock.calls[0];
    expect(booker.email).toBe(BOOKER.email);
    // The booker is moved to attendees[0] (ManageLink, getBookerEventTitle, getWhen); the guest stays behind.
    expect(calEvent.attendees.map((a: { email: string }) => a.email)).toEqual([BOOKER.email, GUEST.email]);
    expect(calEvent.attendees[0]).toBe(booker);
    expect(calEvent.type).toBe("Ogled stanovanja");
    expect(titleSource).toEqual({ eventType: "Ogled stanovanja", eventName: null });
    expect(metadata).toMatchObject({ flowkoReminders: { enabled: true, offsets: [1440, 120] } });
  });

  it("falls back to the lowest attendee id when responses.email matches nobody", async () => {
    db.state.bookings = [row(1, { responses: { email: "someone-else@example.com" } })];

    await run();

    const [calEvent, booker] = mocks.send.mock.calls[0];
    expect(booker.email).toBe(GUEST.email);
    expect(calEvent.attendees[0].email).toBe(GUEST.email);
  });

  it("a booking whose reminder is not due (setting off, made late) is not claimed", async () => {
    db.state.bookings = [
      row(1, {
        eventType: {
          id: 50,
          title: "Ogled",
          eventName: null,
          metadata: { flowkoReminders: { enabled: false, offsets: [1440] } },
        },
      }),
      row(2, { eventType: { id: 51, title: "Ogled", eventName: null, metadata: null } }),
      row(3, { createdAt: new Date(NOW.getTime() - MIN) }),
    ];

    const res = await run();

    expect(res.body).toEqual({ due: 0, sent: 0, failed: 0, skipped: 0 });
    expect(db.prisma.flowkoAttendeeReminder.createMany).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("unreadable metadata elsewhere (attendee opt-out unknown): due, but nothing claimed or sent", async () => {
    db.state.bookings = [
      row(1, {
        eventType: {
          id: 50,
          title: "Ogled",
          eventName: null,
          metadata: { flowkoReminders: { enabled: true, offsets: [1440] }, bookerLayouts: "garbage" },
        },
      }),
    ];

    const res = await run();

    expect(res.body).toEqual({ due: 1, sent: 0, failed: 0, skipped: 1 });
    expect(db.prisma.flowkoAttendeeReminder.createMany).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("two overlapping runs send one mail per (booking, offset)", async () => {
    db.state.bookings = [row(1), row(2)];

    const [a, b] = await Promise.all([run(), run()]);

    expect(mocks.send).toHaveBeenCalledTimes(2);
    const sentTo = mocks.send.mock.calls.map((c) => c[0].uid).sort();
    expect(sentTo).toEqual(["uid-1", "uid-2"]);
    const total = (k: "sent" | "skipped") =>
      (a.body as Record<string, number>)[k] + (b.body as Record<string, number>)[k];
    expect(total("sent")).toBe(2);
    expect(total("skipped")).toBe(2);

    // A third run (e.g. after a crash and restart) sends nothing either.
    await run();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  /** A transport failure as BaseEmail wraps it; the nodemailer-shaped cause decides definitelyNotSent. */
  const transportError = (fields: {
    code: string;
    responseCode?: number;
    command?: string;
  }): MailTransportError =>
    new MailTransportError(Object.assign(new Error("550 rejected booker@example.com"), fields));

  it("a refused send releases the claim, and the next run sends", async () => {
    db.state.bookings = [row(1)];
    const refused = transportError({ code: "EENVELOPE", responseCode: 550, command: "RCPT TO" });
    expect(refused.definitelyNotSent).toBe(true);
    mocks.send.mockRejectedValueOnce(refused);

    const first = await run();

    expect(first.body).toEqual({ due: 1, sent: 0, failed: 1, skipped: 0 });
    expect(db.prisma.flowkoAttendeeReminder.deleteMany).toHaveBeenCalledWith({
      where: { bookingId: 1, offsetMinutes: 1440 },
    });
    expect(db.claims.size).toBe(0);

    const second = await run();

    expect(second.body).toEqual({ due: 1, sent: 1, failed: 0, skipped: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(Array.from(db.claims)).toEqual(["1:1440"]);
  });

  it("a refused connection (connect stage) releases the claim, and the next run sends", async () => {
    db.state.bookings = [row(1)];
    const refused = new MailTransportError(
      Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:587"), {
        code: "ESOCKET",
        command: "CONN",
        syscall: "connect",
      })
    );
    expect(refused.definitelyNotSent).toBe(true);
    mocks.send.mockRejectedValueOnce(refused);

    expect((await run()).body).toEqual({ due: 1, sent: 0, failed: 1, skipped: 0 });
    expect(db.claims.size).toBe(0);
    expect((await run()).body).toEqual({ due: 1, sent: 1, failed: 0, skipped: 0 });
  });

  it("a transport failure the server may have taken (no answer mid-DATA) keeps the claim: failed, never retried", async () => {
    db.state.bookings = [row(1)];
    const ambiguous = transportError({ code: "ETIMEDOUT", command: "CONN" });
    expect(ambiguous.definitelyNotSent).toBe(false);
    mocks.send.mockRejectedValueOnce(ambiguous);

    const first = await run();

    expect(first.body).toEqual({ due: 1, sent: 0, failed: 1, skipped: 0 });
    expect(db.prisma.flowkoAttendeeReminder.deleteMany).not.toHaveBeenCalled();
    expect(Array.from(db.claims)).toEqual(["1:1440"]);

    await run();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("a booking no longer ACCEPTED when the claim is taken is skipped and keeps its claim", async () => {
    db.state.bookings = [row(1)];
    mocks.getBookingForCalEventBuilder.mockImplementation(async (id: number) => fullBooking(id, "CANCELLED"));

    const res = await run();

    expect(res.body).toEqual({ due: 1, sent: 0, failed: 0, skipped: 1 });
    expect(mocks.fromBooking).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(Array.from(db.claims)).toEqual(["1:1440"]);

    await run();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("a kill switch hit at send time releases the claim (counted failed)", async () => {
    db.state.bookings = [row(1)];
    mocks.send.mockResolvedValueOnce("skipped_kill_switch");

    const res = await run();

    expect(res.body).toEqual({ due: 1, sent: 0, failed: 1, skipped: 0 });
    expect(db.claims.size).toBe(0);
  });

  it.each([
    "skipped_disabled",
    "skipped_faux",
    "skipped_test_mode",
  ])("%s keeps the claim (counted skipped, never retried)", async (outcome) => {
    db.state.bookings = [row(1)];
    mocks.send.mockResolvedValueOnce(outcome);

    const res = await run();

    expect(res.body).toEqual({ due: 1, sent: 0, failed: 0, skipped: 1 });
    expect(db.prisma.flowkoAttendeeReminder.deleteMany).not.toHaveBeenCalled();
    expect(Array.from(db.claims)).toEqual(["1:1440"]);

    await run();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("a booking whose event cannot be built fails alone: claim released, the others still sent", async () => {
    db.state.bookings = [row(1), row(2), row(3)];
    mocks.fromBooking.mockImplementation(async (booking: ReturnType<typeof fullBooking>) => {
      if (booking.id === 2) throw new Error(`Booking ${booking.uid} is missing eventType`);
      return { build: () => builtEvent(booking) };
    });

    const res = await run();

    expect(res.body).toEqual({ due: 3, sent: 2, failed: 1, skipped: 0 });
    expect(mocks.send.mock.calls.map((c) => c[0].uid)).toEqual(["uid-1", "uid-3"]);
    expect(Array.from(db.claims).sort()).toEqual(["1:1440", "3:1440"]);
  });

  it("a booking gone before the build (null) fails alone and releases its claim", async () => {
    db.state.bookings = [row(1), row(2)];
    mocks.getBookingForCalEventBuilder.mockImplementation(async (id: number) =>
      id === 1 ? null : fullBooking(id)
    );

    const res = await run();

    expect(res.body).toEqual({ due: 2, sent: 1, failed: 1, skipped: 0 });
    expect(Array.from(db.claims)).toEqual(["2:1440"]);
  });

  it("a booking deleted between select and claim (FK error) fails alone, nothing to release", async () => {
    db.state.bookings = [row(1), row(2)];
    db.state.deleted.add(1);

    const res = await run();

    expect(res.body).toEqual({ due: 2, sent: 1, failed: 1, skipped: 0 });
    expect(db.prisma.flowkoAttendeeReminder.deleteMany).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls.map((c) => c[0].uid)).toEqual(["uid-2"]);
  });

  it("response and logs carry counts only: no ids, uids, e-mails, names or error messages", async () => {
    db.state.bookings = [row(1), row(2), row(3)];
    db.state.deleted.add(1);
    mocks.send.mockRejectedValueOnce(
      transportError({ code: "EENVELOPE", responseCode: 550, command: "RCPT TO" })
    );

    const res = await run();

    expect(res.body).toEqual({ due: 3, sent: 1, failed: 2, skipped: 0 });
    expect(mocks.log.info).toHaveBeenCalledTimes(1);
    expect(mocks.log.info.mock.calls[0]).toContainEqual({ due: 3, sent: 1, failed: 2, skipped: 0 });

    const everything = JSON.stringify([
      res.body,
      mocks.log.info.mock.calls,
      mocks.log.warn.mock.calls,
      mocks.log.error.mock.calls,
      mocks.log.debug.mock.calls,
    ]);
    for (const leak of ["@", "uid-", "Booker", "Guest", "Hana", "rejected", "Foreign key", "550"]) {
      expect(everything).not.toContain(leak);
    }
    // The error class/code is logged, so a failure is still diagnosable.
    expect(everything).toContain("P2003");
    expect(everything).toContain("MailTransportError");
  });
});
