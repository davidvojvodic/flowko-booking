// Flowko U27: bookings API handlers + schemas. The services are mocked (they have their own tests); this file pins
// what the API layer adds: the actor id, a Date for `start`, the error mapping, needs_confirm as data, the rate
// limit and the exact input shape.
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getFreeStarts: vi.fn(),
  createBusinessBooking: vi.fn(),
  cancelBusinessBooking: vi.fn(),
  moveBusinessBooking: vi.fn(),
  getDeskDay: vi.fn(),
  getDeskWeek: vi.fn(),
  findCustomers: vi.fn(),
  setBusinessNoShow: vi.fn(),
  checkRateLimitAndThrowError: vi.fn(),
  prisma: { marker: "prisma" },
}));

vi.mock("@calcom/prisma", () => ({ prisma: m.prisma, default: m.prisma }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({
  checkRateLimitAndThrowError: m.checkRateLimitAndThrowError,
}));
vi.mock("@calcom/features/flowkoBusiness/bookingDay", () => ({ getFreeStarts: m.getFreeStarts }));
vi.mock("@calcom/features/flowkoBusiness/bookingWriter", () => ({
  createBusinessBooking: m.createBusinessBooking,
}));
vi.mock("@calcom/features/flowkoBusiness/bookingChange", () => ({
  cancelBusinessBooking: m.cancelBusinessBooking,
  moveBusinessBooking: m.moveBusinessBooking,
}));
vi.mock("@calcom/features/flowkoBusiness/desk", () => ({
  getDeskDay: m.getDeskDay,
  getDeskWeek: m.getDeskWeek,
  findCustomers: m.findCustomers,
}));
vi.mock("@calcom/features/flowkoBusiness/bookingNoShow", () => ({
  setBusinessNoShow: m.setBusinessNoShow,
}));

import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";

import { flowkoRouter } from "../_router";
import * as handlers from "./bookings.handler";
import * as schemas from "./bookings.schema";

const ctx = { user: { id: 7 } } as never;
const START = "2026-11-16T08:00:00Z";
const customer = { name: "Ana Novak", email: "ana@example.si", phone: null };

type Case = {
  name: string;
  service: ReturnType<typeof vi.fn>;
  run: () => Promise<unknown>;
  args: unknown[];
  // Flowko U28: the desk reads have their own bucket
  limiterId?: string;
};

const cases: Case[] = [
  {
    name: "freeStarts",
    service: m.getFreeStarts,
    run: () => handlers.freeStartsHandler({ ctx, input: { date: "2026-11-16", serviceIds: [1, 2] } }),
    args: [m.prisma, 7, { date: "2026-11-16", serviceIds: [1, 2] }, expect.any(Date)],
  },
  {
    name: "create",
    service: m.createBusinessBooking,
    run: () =>
      handlers.createHandler({
        ctx,
        input: {
          workerMemberId: 3,
          serviceIds: [1],
          start: START,
          customer,
          confirmOverride: false,
          actorMemberId: 4,
        },
      }),
    args: [
      m.prisma,
      7,
      {
        workerMemberId: 3,
        serviceIds: [1],
        start: new Date(START),
        customer,
        confirmOverride: false,
        actorMemberId: 4,
      },
      expect.any(Date),
    ],
  },
  {
    name: "cancel",
    service: m.cancelBusinessBooking,
    run: () =>
      handlers.cancelHandler({ ctx, input: { bookingId: 9, reason: "sick", actorMemberId: null } }),
    args: [m.prisma, 7, { bookingId: 9, reason: "sick", actorMemberId: null }, expect.any(Date)],
  },
  {
    name: "move",
    service: m.moveBusinessBooking,
    run: () =>
      handlers.moveHandler({
        ctx,
        input: { bookingId: 9, start: START, confirmOverride: true, actorMemberId: undefined },
      }),
    args: [m.prisma, 7, { bookingId: 9, start: new Date(START), confirmOverride: true }, expect.any(Date)],
  },
  // Flowko U28
  {
    name: "day",
    service: m.getDeskDay,
    run: () => handlers.dayHandler({ ctx, input: { date: "2026-11-16" } }),
    args: [m.prisma, 7, { date: "2026-11-16" }, expect.any(Date)],
    limiterId: "flowkoDesk:7",
  },
  {
    name: "week",
    service: m.getDeskWeek,
    run: () => handlers.weekHandler({ ctx, input: { weekStart: "2026-11-16", memberId: 3 } }),
    args: [m.prisma, 7, { weekStart: "2026-11-16", memberId: 3 }, expect.any(Date)],
    limiterId: "flowkoDesk:7",
  },
  {
    name: "customers",
    service: m.findCustomers,
    run: () => handlers.customersHandler({ ctx, input: { query: "ana" } }),
    args: [m.prisma, 7, { query: "ana" }],
    limiterId: "flowkoDesk:7",
  },
  {
    name: "noShow",
    service: m.setBusinessNoShow,
    run: () =>
      handlers.noShowHandler({ ctx, input: { bookingId: 9, noShow: true, actorMemberId: 4 } }),
    args: [m.prisma, 7, { bookingId: 9, noShow: true, actorMemberId: 4 }, expect.any(Date)],
  },
];

describe("viewer.flowko.bookings handlers (Flowko U27)", () => {
  beforeEach(() => {
    for (const c of cases) c.service.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
    m.checkRateLimitAndThrowError.mockResolvedValue({ success: true });
  });

  it.each(cases)("$name calls its service with the session user id and a Date for now", async (c) => {
    c.service.mockResolvedValue("result");
    await expect(c.run()).resolves.toBe("result");
    expect(c.service).toHaveBeenCalledTimes(1);
    expect(c.service.mock.calls[0]).toEqual(c.args);
  });

  it("create and move hand the service a Date for start, not a string", async () => {
    m.createBusinessBooking.mockResolvedValue({});
    m.moveBusinessBooking.mockResolvedValue({});
    await cases[1].run();
    await cases[3].run();
    expect(m.createBusinessBooking.mock.calls[0][2].start).toBeInstanceOf(Date);
    expect(m.createBusinessBooking.mock.calls[0][2].start.toISOString()).toBe("2026-11-16T08:00:00.000Z");
    expect(m.moveBusinessBooking.mock.calls[0][2].start).toBeInstanceOf(Date);
  });

  it.each(cases)("$name maps forbidden to FORBIDDEN", async (c) => {
    c.service.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const err = await c.run().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
  });

  it.each(cases)("$name maps duplicate_time to BAD_REQUEST with the code as message", async (c) => {
    c.service.mockRejectedValue(new FlowkoBusinessError("duplicate_time"));
    const err = await c.run().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("duplicate_time");
  });

  it.each(cases)("$name rethrows a non-Flowko error unchanged", async (c) => {
    const boom = new Error("db down");
    c.service.mockRejectedValue(boom);
    await expect(c.run()).rejects.toBe(boom);
  });

  it.each(cases)("$name rate limits as flowkoBookings:<id> (desk reads: flowkoDesk:<id>), before the service", async (c) => {
    c.service.mockResolvedValue(undefined);
    await c.run();
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledTimes(1);
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledWith({
      identifier: c.limiterId ?? "flowkoBookings:7",
      rateLimitingType: "common",
    });
    expect(m.checkRateLimitAndThrowError.mock.invocationCallOrder[0]).toBeLessThan(
      c.service.mock.invocationCallOrder[0]
    );
  });

  it.each(cases)("$name: a rate-limit refusal stops the call before the service runs", async (c) => {
    const limited = new Error("429");
    m.checkRateLimitAndThrowError.mockRejectedValue(limited);
    await expect(c.run()).rejects.toBe(limited);
    expect(c.service).not.toHaveBeenCalled();
  });

  it("needs_confirm comes back as data, not an error (create and move)", async () => {
    const problems = [{ kind: "overlap" }];
    // Flowko U28: needs_confirm carries googleUnavailable (Task 3)
    const answer = { status: "needs_confirm", problems, googleUnavailable: false };
    m.createBusinessBooking.mockResolvedValue(answer);
    m.moveBusinessBooking.mockResolvedValue(answer);
    await expect(cases[1].run()).resolves.toEqual(answer);
    await expect(cases[3].run()).resolves.toEqual(answer);
  });

  // Flowko U28: Task 3 added googleUnavailable to needs_confirm
  it("needs_confirm keeps googleUnavailable as data", async () => {
    const answer = { status: "needs_confirm", problems: [], googleUnavailable: true };
    m.createBusinessBooking.mockResolvedValue(answer);
    await expect(cases[1].run()).resolves.toEqual(answer);
  });

  it.each(["in_past", "booking_not_started"])("%s maps to BAD_REQUEST with the code as message", async (code) => {
    m.setBusinessNoShow.mockRejectedValue(new FlowkoBusinessError(code as never));
    m.createBusinessBooking.mockRejectedValue(new FlowkoBusinessError(code as never));
    for (const c of [cases[1], cases[7]]) {
      const err = await c.run().catch((e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toBe(code);
    }
  });

  it("day and week take 'now' from the server clock, not the input", async () => {
    m.getDeskDay.mockResolvedValue({});
    const before = Date.now();
    await cases[4].run();
    const now = m.getDeskDay.mock.calls[0][3] as Date;
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

const okInputs = {
  freeStarts: { date: "2026-11-16", serviceIds: [1, 2] },
  create: {
    workerMemberId: 3,
    serviceIds: [1],
    start: START,
    customer: { name: "Ana", email: null, phone: "+38641000000" },
    confirmOverride: false,
    actorMemberId: null,
  },
  cancel: { bookingId: 9, reason: null, actorMemberId: 2 },
  move: { bookingId: 9, start: START, confirmOverride: true, actorMemberId: null },
  // Flowko U28
  day: { date: "2026-11-16" },
  week: { weekStart: "2026-11-16", memberId: 3 },
  customers: { query: "ana" },
  noShow: { bookingId: 9, noShow: false, actorMemberId: null },
} as const;

const schemaByName = {
  freeStarts: schemas.ZFreeStartsInput,
  create: schemas.ZCreateBookingInput,
  cancel: schemas.ZCancelBookingInput,
  move: schemas.ZMoveBookingInput,
  day: schemas.ZDayInput,
  week: schemas.ZWeekInput,
  customers: schemas.ZCustomersInput,
  noShow: schemas.ZNoShowInput,
} as const;

describe("bookings input schemas (Flowko U27)", () => {
  const names = Object.keys(okInputs) as (keyof typeof okInputs)[];

  it.each(names)("%s accepts its valid input", (name) => {
    expect(schemaByName[name].safeParse(okInputs[name]).success).toBe(true);
  });

  it.each(names)("%s refuses an extra key", (name) => {
    expect(schemaByName[name].safeParse({ ...okInputs[name], extra: 1 }).success).toBe(false);
  });

  it.each(names)("%s refuses a missing required key", (name) => {
    const input: Record<string, unknown> = { ...okInputs[name] };
    delete input[Object.keys(input)[0]];
    expect(schemaByName[name].safeParse(input).success).toBe(false);
  });

  it("start must be a UTC ISO instant (Z): an offset or local string fails", () => {
    const ok = (start: string) => schemas.ZMoveBookingInput.safeParse({ bookingId: 1, start }).success;
    expect(ok("2026-11-16T08:00:00Z")).toBe(true);
    expect(ok("2026-11-16T08:00:00.000Z")).toBe(true);
    expect(ok("2026-11-16T09:00:00+01:00")).toBe(false);
    expect(ok("2026-11-16 09:00")).toBe(false);
    expect(ok("2026-11-16")).toBe(false);
    expect(ok("not a date")).toBe(false);
  });

  it("serviceIds: 1 to 5 positive ints; 0, 6, fractions and strings fail", () => {
    const ok = (serviceIds: unknown) =>
      schemas.ZFreeStartsInput.safeParse({ date: "2026-11-16", serviceIds }).success;
    expect(ok([1])).toBe(true);
    expect(ok([1, 2, 3, 4, 5])).toBe(true);
    expect(ok([])).toBe(false);
    expect(ok([1, 2, 3, 4, 5, 6])).toBe(false);
    expect(ok([0])).toBe(false);
    expect(ok([1.5])).toBe(false);
    expect(ok(["1"])).toBe(false);
    expect(
      schemas.ZCreateBookingInput.safeParse({ ...okInputs.create, serviceIds: [1, 2, 3, 4, 5, 6] }).success
    ).toBe(false);
  });

  it("reason: 500 chars pass, 501 fail; null and missing pass", () => {
    const ok = (reason: unknown) => schemas.ZCancelBookingInput.safeParse({ bookingId: 1, reason }).success;
    expect(ok("x".repeat(500))).toBe(true);
    expect(ok("x".repeat(501))).toBe(false);
    expect(ok(null)).toBe(true);
    expect(schemas.ZCancelBookingInput.safeParse({ bookingId: 1 }).success).toBe(true);
  });

  it("date must be a real calendar date", () => {
    expect(schemas.ZFreeStartsInput.safeParse({ date: "2026-02-30", serviceIds: [1] }).success).toBe(false);
    expect(schemas.ZFreeStartsInput.safeParse({ date: "16.11.2026", serviceIds: [1] }).success).toBe(false);
  });

  it("ids are positive ints; actorMemberId may be null or missing", () => {
    for (const bad of [0, -1, 1.5, "1", null]) {
      expect(schemas.ZCancelBookingInput.safeParse({ bookingId: bad }).success).toBe(false);
      expect(schemas.ZCreateBookingInput.safeParse({ ...okInputs.create, workerMemberId: bad }).success).toBe(
        false
      );
    }
    expect(schemas.ZCancelBookingInput.safeParse({ bookingId: 1, actorMemberId: 0 }).success).toBe(false);
    expect(schemas.ZCancelBookingInput.safeParse({ bookingId: 1, actorMemberId: null }).success).toBe(true);
  });

  it("confirmOverride defaults to false and must be a real boolean", () => {
    const parsed = schemas.ZMoveBookingInput.safeParse({ bookingId: 1, start: START });
    expect(parsed.success && parsed.data.confirmOverride).toBe(false);
    expect(schemas.ZMoveBookingInput.safeParse({ bookingId: 1, start: START, confirmOverride: "yes" }).success).toBe(
      false
    );
  });

  it("customer: name required, email and phone optional or null, no extra keys", () => {
    const ok = (c: unknown) => schemas.ZCreateBookingInput.safeParse({ ...okInputs.create, customer: c }).success;
    expect(ok({ name: "Ana" })).toBe(true);
    expect(ok({ name: "Ana", email: null, phone: null })).toBe(true);
    expect(ok({ email: "a@b.si" })).toBe(false);
    expect(ok({ name: "Ana", extra: 1 })).toBe(false);
  });
});

describe("desk input schemas (Flowko U28)", () => {
  it("date: a real ISO calendar date; a dotted date fails", () => {
    expect(schemas.ZDayInput.safeParse({ date: "2026-11-16" }).success).toBe(true);
    expect(schemas.ZDayInput.safeParse({ date: "16.11.2026" }).success).toBe(false);
    expect(schemas.ZWeekInput.safeParse({ weekStart: "16.11.2026", memberId: 1 }).success).toBe(false);
    expect(schemas.ZWeekInput.safeParse({ weekStart: "2026-11-16", memberId: 0 }).success).toBe(false);
  });

  it("query: trimmed, 1 to 80 chars; blank and 81 chars fail", () => {
    const parsed = schemas.ZCustomersInput.safeParse({ query: "  ana  " });
    expect(parsed.success && parsed.data.query).toBe("ana");
    expect(schemas.ZCustomersInput.safeParse({ query: "x".repeat(80) }).success).toBe(true);
    expect(schemas.ZCustomersInput.safeParse({ query: "x".repeat(81) }).success).toBe(false);
    expect(schemas.ZCustomersInput.safeParse({ query: "   " }).success).toBe(false);
  });

  it("noShow must be a real boolean", () => {
    expect(schemas.ZNoShowInput.safeParse({ bookingId: 1, noShow: "true" }).success).toBe(false);
    expect(schemas.ZNoShowInput.safeParse({ bookingId: 1 }).success).toBe(false);
    expect(schemas.ZNoShowInput.safeParse({ bookingId: 1, noShow: true }).success).toBe(true);
  });

  it("create customer caps (R17): name 80, e-mail 254, phone 32; one over fails", () => {
    const ok = (customer: unknown) =>
      schemas.ZCreateBookingInput.safeParse({ ...okInputs.create, customer }).success;
    expect(ok({ name: "n".repeat(80), email: "e".repeat(254), phone: "1".repeat(32) })).toBe(true);
    expect(ok({ name: "n".repeat(81) })).toBe(false);
    expect(ok({ name: "Ana", email: "e".repeat(255) })).toBe(false);
    expect(ok({ name: "Ana", phone: "1".repeat(33) })).toBe(false);
  });
});

describe("flowko router wiring (Flowko U27)", () => {
  it("flowkoRouter serves the eight roster.* procedures plus the five U27 ones and six U28 ones", () => {
    expect(Object.keys(flowkoRouter._def.procedures).sort()).toEqual(
      [
        "roster.week",
        "roster.setUsualWeek",
        "roster.setWeek",
        "roster.copyWeek",
        "roster.addAbsence",
        "roster.removeAbsence",
        "roster.setHolidaysClosed",
        "roster.setHolidayOpen",
        "bookings.freeStarts",
        "bookings.create",
        "bookings.cancel",
        "bookings.move",
        "business.me",
        // Flowko U28
        "bookings.day",
        "bookings.week",
        "bookings.customers",
        "bookings.noShow",
        "business.services",
        "business.members",
      ].sort()
    );
  });
});
