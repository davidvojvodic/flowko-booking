// Flowko U26: roster API handlers + schemas + router wiring. The services are mocked (they have their own tests);
// this file pins what the API layer adds: the actor id, the error mapping, the rate limit and the exact input shape.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getRosterWeek: vi.fn(),
  setUsualWeek: vi.fn(),
  setRosterWeek: vi.fn(),
  copyRosterWeek: vi.fn(),
  addAbsence: vi.fn(),
  removeAbsence: vi.fn(),
  setHolidaysClosed: vi.fn(),
  setHolidayOpen: vi.fn(),
  saveRosterWeek: vi.fn(),
  saveUsualWeeks: vi.fn(),
  checkRateLimitAndThrowError: vi.fn(),
  prisma: { marker: "prisma" },
}));

vi.mock("@calcom/prisma", () => ({ prisma: m.prisma, default: m.prisma }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({
  checkRateLimitAndThrowError: m.checkRateLimitAndThrowError,
}));
vi.mock("@calcom/features/flowkoBusiness/roster", () => ({
  getRosterWeek: m.getRosterWeek,
  setUsualWeek: m.setUsualWeek,
  setRosterWeek: m.setRosterWeek,
  copyRosterWeek: m.copyRosterWeek,
  addAbsence: m.addAbsence,
  removeAbsence: m.removeAbsence,
  setHolidaysClosed: m.setHolidaysClosed,
  setHolidayOpen: m.setHolidayOpen,
  // Flowko U29b (S3, S4)
  saveRosterWeek: m.saveRosterWeek,
  saveUsualWeeks: m.saveUsualWeeks,
}));

import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";
import { ENDPOINTS } from "@calcom/trpc/react/shared";

import { flowkoTrpcError } from "../flowkoTrpcError";
import { flowkoRouter } from "../_router";
import * as handlers from "./roster.handler";
import * as schemas from "./roster.schema";

const ctx = { user: { id: 7 } } as never;
const WEEK = "2026-11-09";
const VERSION = "a".repeat(64);
const week = { mon: [], tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
const usual = {
  mon: [{ from: "09:00", to: "17:00" }],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};

type Case = {
  name: string;
  mutation: boolean;
  service: ReturnType<typeof vi.fn>;
  run: () => Promise<unknown>;
  args: unknown[];
};

const cases: Case[] = [
  {
    name: "week",
    mutation: false,
    service: m.getRosterWeek,
    run: () => handlers.weekHandler({ ctx, input: { weekStart: WEEK } }),
    args: [m.prisma, 7, WEEK, expect.any(Date)],
  },
  {
    name: "setUsualWeek",
    mutation: true,
    service: m.setUsualWeek,
    run: () =>
      handlers.setUsualWeekHandler({
        ctx,
        input: { memberId: 3, usualWeek: usual as never, confirmOutsideOpening: false },
      }),
    args: [m.prisma, 7, { memberId: 3, usualWeek: usual, confirmOutsideOpening: false }],
  },
  {
    name: "setWeek",
    mutation: true,
    service: m.setRosterWeek,
    run: () =>
      handlers.setWeekHandler({
        ctx,
        input: { memberId: 3, weekStart: WEEK, days: week as never, confirmOutsideOpening: true },
      }),
    args: [
      m.prisma,
      7,
      { memberId: 3, weekStart: WEEK, days: week, confirmOutsideOpening: true },
      expect.any(Date),
    ],
  },
  {
    name: "copyWeek",
    mutation: true,
    service: m.copyRosterWeek,
    run: () =>
      handlers.copyWeekHandler({
        ctx,
        input: { fromWeekStart: WEEK, toWeekStart: "2026-11-16", memberIds: [3, 4] },
      }),
    args: [m.prisma, 7, { fromWeekStart: WEEK, toWeekStart: "2026-11-16", memberIds: [3, 4] }, expect.any(Date)],
  },
  {
    name: "addAbsence",
    mutation: true,
    service: m.addAbsence,
    run: () =>
      handlers.addAbsenceHandler({
        ctx,
        input: { memberId: 3, startDate: "2026-11-10", endDate: "2026-11-12", confirm: true },
      }),
    args: [
      m.prisma,
      7,
      { memberId: 3, startDate: "2026-11-10", endDate: "2026-11-12", confirm: true },
      expect.any(Date),
    ],
  },
  {
    name: "removeAbsence",
    mutation: true,
    service: m.removeAbsence,
    run: () => handlers.removeAbsenceHandler({ ctx, input: { absenceId: 9 } }),
    args: [m.prisma, 7, 9, expect.any(Date)],
  },
  {
    name: "setHolidaysClosed",
    mutation: true,
    service: m.setHolidaysClosed,
    run: () => handlers.setHolidaysClosedHandler({ ctx, input: { closed: true } }),
    args: [m.prisma, 7, true],
  },
  {
    name: "setHolidayOpen",
    mutation: true,
    service: m.setHolidayOpen,
    run: () => handlers.setHolidayOpenHandler({ ctx, input: { date: "2026-12-25", open: true } }),
    args: [m.prisma, 7, { date: "2026-12-25", open: true }, expect.any(Date)],
  },
  // Flowko U29b (S3, S4, S17)
  {
    name: "saveWeek",
    mutation: true,
    service: m.saveRosterWeek,
    run: () =>
      handlers.saveWeekHandler({
        ctx,
        input: { weekStart: WEEK, rows: [{ memberId: 3, version: VERSION, days: week as never }], confirm: true },
      }),
    args: [
      m.prisma,
      7,
      { weekStart: WEEK, rows: [{ memberId: 3, version: VERSION, days: week }], confirm: true },
      expect.any(Date),
    ],
  },
  {
    name: "saveUsualWeeks",
    mutation: true,
    service: m.saveUsualWeeks,
    run: () =>
      handlers.saveUsualWeeksHandler({
        ctx,
        input: {
          rows: [
            { memberId: 3, version: VERSION, usualWeek: usual as never },
            { memberId: 4, version: VERSION, usualWeek: null },
          ],
          confirm: false,
        },
      }),
    args: [
      m.prisma,
      7,
      {
        rows: [
          { memberId: 3, version: VERSION, usualWeek: usual },
          { memberId: 4, version: VERSION, usualWeek: null },
        ],
        confirm: false,
      },
      expect.any(Date),
    ],
  },
];

describe("viewer.flowko.roster handlers (Flowko U26)", () => {
  beforeEach(() => {
    for (const c of cases) c.service.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
    m.checkRateLimitAndThrowError.mockResolvedValue({ success: true });
  });

  it.each(cases)("$name calls its service with the session user id, never one from the input", async (c) => {
    c.service.mockResolvedValue("result");
    await expect(c.run()).resolves.toBe("result");
    expect(c.service).toHaveBeenCalledTimes(1);
    expect(c.service.mock.calls[0]).toEqual(c.args);
  });

  it.each(cases)("$name maps a forbidden service error to TRPCError FORBIDDEN", async (c) => {
    c.service.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const err = await c.run().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
  });

  it.each(cases)("$name maps outside_opening to BAD_REQUEST with the code as message", async (c) => {
    c.service.mockRejectedValue(new FlowkoBusinessError("outside_opening"));
    const err = await c.run().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("outside_opening");
  });

  it.each(cases)("$name rethrows a non-Flowko error unchanged", async (c) => {
    const boom = new Error("db down");
    c.service.mockRejectedValue(boom);
    await expect(c.run()).rejects.toBe(boom);
  });

  it.each(cases)("$name rate limits (mutations only) as flowkoRoster:<id>, before the service", async (c) => {
    c.service.mockResolvedValue(undefined);
    await c.run();
    if (!c.mutation) {
      expect(m.checkRateLimitAndThrowError).not.toHaveBeenCalled();
      return;
    }
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledTimes(1);
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledWith({
      identifier: "flowkoRoster:7",
      rateLimitingType: "common",
    });
    expect(m.checkRateLimitAndThrowError.mock.invocationCallOrder[0]).toBeLessThan(
      c.service.mock.invocationCallOrder[0]
    );
  });

  it("a rate-limit refusal stops a mutation before the service runs", async () => {
    const limited = new Error("429");
    m.checkRateLimitAndThrowError.mockRejectedValue(limited);
    await expect(handlers.setHolidaysClosedHandler({ ctx, input: { closed: true } })).rejects.toBe(limited);
    expect(m.setHolidaysClosed).not.toHaveBeenCalled();
  });

  it("addAbsence: an input without confirm reaches the service with confirm false; the result is forwarded", async () => {
    const saved = { status: "needs_confirm", bookings: 2 };
    m.addAbsence.mockResolvedValue(saved);
    const input = schemas.ZAddAbsenceInput.parse({ memberId: 3, startDate: "2026-11-10", endDate: "2026-11-12" });
    await expect(handlers.addAbsenceHandler({ ctx, input })).resolves.toBe(saved);
    expect(m.addAbsence.mock.calls[0]).toEqual([
      m.prisma,
      7,
      { memberId: 3, startDate: "2026-11-10", endDate: "2026-11-12", confirm: false },
      expect.any(Date),
    ]);
  });

  it.each(["saveWeek", "saveUsualWeeks"] as const)(
    "%s: a roster_changed service error reaches the client as BAD_REQUEST with the code as message",
    async (name) => {
      const c = cases.find((x) => x.name === name)!;
      c.service.mockRejectedValue(new FlowkoBusinessError("roster_changed"));
      const err = await c.run().catch((e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toBe("roster_changed");
    }
  );

  it("flowkoTrpcError: other business codes become BAD_REQUEST with the code", () => {
    for (const code of ["bad_roster", "week_out_of_range", "bad_absence", "not_a_holiday", "same_week", "roster_conflict", "roster_changed"] as const) {
      try {
        flowkoTrpcError(new FlowkoBusinessError(code));
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(TRPCError);
        expect((e as TRPCError).code).toBe("BAD_REQUEST");
        expect((e as TRPCError).message).toBe(code);
      }
    }
  });
});

const okInputs = {
  week: { weekStart: "2026-11-10" },
  setUsualWeek: { memberId: 1, usualWeek: usual, confirmOutsideOpening: false },
  setWeek: { memberId: 1, weekStart: "2026-11-10", days: week, confirmOutsideOpening: false },
  copyWeek: { fromWeekStart: "2026-11-09", toWeekStart: "2026-11-16", memberIds: [1] },
  addAbsence: { memberId: 1, startDate: "2026-11-10", endDate: "2026-11-11", confirm: false },
  removeAbsence: { absenceId: 1 },
  setHolidaysClosed: { closed: true },
  setHolidayOpen: { date: "2026-12-25", open: false },
  saveWeek: { weekStart: "2026-11-09", rows: [{ memberId: 1, version: VERSION, days: week }], confirm: false },
  saveUsualWeeks: { rows: [{ memberId: 1, version: VERSION, usualWeek: usual }], confirm: false },
} as const;

const schemaByName = {
  week: schemas.ZRosterWeekInput,
  setUsualWeek: schemas.ZSetUsualWeekInput,
  setWeek: schemas.ZSetWeekInput,
  copyWeek: schemas.ZCopyWeekInput,
  addAbsence: schemas.ZAddAbsenceInput,
  removeAbsence: schemas.ZRemoveAbsenceInput,
  setHolidaysClosed: schemas.ZSetHolidaysClosedInput,
  setHolidayOpen: schemas.ZSetHolidayOpenInput,
  saveWeek: schemas.ZSaveWeekInput,
  saveUsualWeeks: schemas.ZSaveUsualWeeksInput,
} as const;

describe("roster input schemas (Flowko U26)", () => {
  const names = Object.keys(okInputs) as (keyof typeof okInputs)[];

  it.each(names)("%s accepts its valid input", (name) => {
    expect(schemaByName[name].safeParse(okInputs[name]).success).toBe(true);
  });

  it.each(names)("%s refuses an extra key", (name) => {
    expect(schemaByName[name].safeParse({ ...okInputs[name], extra: 1 }).success).toBe(false);
  });

  it.each(names)("%s refuses a missing required key", (name) => {
    const input: Record<string, unknown> = { ...okInputs[name] };
    const first = Object.keys(input)[0];
    delete input[first];
    expect(schemaByName[name].safeParse(input).success).toBe(false);
  });

  it("a Monday date passes zod (the Monday check is the service's); a non-date fails", () => {
    expect(schemas.ZRosterWeekInput.safeParse({ weekStart: "2026-11-10" }).success).toBe(true);
    expect(schemas.ZRosterWeekInput.safeParse({ weekStart: "2026-02-30" }).success).toBe(false);
    expect(schemas.ZRosterWeekInput.safeParse({ weekStart: "11/10/2026" }).success).toBe(false);
  });

  it("memberIds: up to 50 positive ints or null; 51, zero, fractions, strings fail", () => {
    const base = { fromWeekStart: "2026-11-09", toWeekStart: "2026-11-16" };
    const ok = (memberIds: unknown) => schemas.ZCopyWeekInput.safeParse({ ...base, memberIds }).success;
    expect(ok(null)).toBe(true);
    expect(ok([])).toBe(true);
    expect(ok(Array.from({ length: 50 }, (_, i) => i + 1))).toBe(true);
    expect(ok(Array.from({ length: 51 }, (_, i) => i + 1))).toBe(false);
    expect(ok([0])).toBe(false);
    expect(ok([-1])).toBe(false);
    expect(ok([1.5])).toBe(false);
    expect(ok(["1"])).toBe(false);
    expect(schemas.ZCopyWeekInput.safeParse(base).success).toBe(false);
  });

  it("memberId / absenceId: positive ints only", () => {
    for (const bad of [0, -1, 1.5, "1", null]) {
      expect(schemas.ZAddAbsenceInput.safeParse({ ...okInputs.addAbsence, memberId: bad }).success).toBe(false);
      expect(schemas.ZRemoveAbsenceInput.safeParse({ absenceId: bad }).success).toBe(false);
    }
  });

  it("booleans are real booleans; confirmOutsideOpening defaults to false", () => {
    expect(schemas.ZSetHolidaysClosedInput.safeParse({ closed: "true" }).success).toBe(false);
    expect(schemas.ZSetHolidayOpenInput.safeParse({ date: "2026-12-25", open: 1 }).success).toBe(false);
    const parsed = schemas.ZSetUsualWeekInput.safeParse({ memberId: 1, usualWeek: usual });
    expect(parsed.success && parsed.data.confirmOutsideOpening).toBe(false);
    expect(schemas.ZSetWeekInput.safeParse({ memberId: 1, weekStart: WEEK, days: week, confirmOutsideOpening: "yes" }).success).toBe(false);
  });

  it("addAbsence: confirm defaults to false and must be a boolean", () => {
    const base = { memberId: 1, startDate: "2026-11-10", endDate: "2026-11-11" };
    const parsed = schemas.ZAddAbsenceInput.safeParse(base);
    expect(parsed.success && parsed.data.confirm).toBe(false);
    expect(schemas.ZAddAbsenceInput.safeParse({ ...base, confirm: "yes" }).success).toBe(false);
  });

  describe("saveWeek / saveUsualWeeks (Flowko U29b S17)", () => {
    const weekRow = (i: number) => ({ memberId: i + 1, version: VERSION, days: week });
    const usualRow = (i: number) => ({ memberId: i + 1, version: VERSION, usualWeek: usual });
    const saveWeek = (rows: unknown, extra: Record<string, unknown> = {}) =>
      schemas.ZSaveWeekInput.safeParse({ weekStart: WEEK, rows, ...extra });
    const saveUsual = (rows: unknown, extra: Record<string, unknown> = {}) =>
      schemas.ZSaveUsualWeeksInput.safeParse({ rows, ...extra });

    it("rows: 1..50 pass, 0 and 51 fail", () => {
      expect(saveWeek(Array.from({ length: 50 }, (_, i) => weekRow(i))).success).toBe(true);
      expect(saveWeek(Array.from({ length: 51 }, (_, i) => weekRow(i))).success).toBe(false);
      expect(saveWeek([]).success).toBe(false);
      expect(saveUsual(Array.from({ length: 50 }, (_, i) => usualRow(i))).success).toBe(true);
      expect(saveUsual(Array.from({ length: 51 }, (_, i) => usualRow(i))).success).toBe(false);
      expect(saveUsual([]).success).toBe(false);
    });

    it("version: exactly 64 lowercase hex characters", () => {
      for (const version of ["a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), "", 5]) {
        expect(saveWeek([{ ...weekRow(0), version }]).success).toBe(false);
        expect(saveUsual([{ ...usualRow(0), version }]).success).toBe(false);
      }
      expect(saveWeek([{ ...weekRow(0), version: "0123456789abcdef".repeat(4) }]).success).toBe(true);
    });

    it("an unknown key is refused at the top level and inside a row", () => {
      expect(saveWeek([weekRow(0)], { extra: 1 }).success).toBe(false);
      expect(saveWeek([{ ...weekRow(0), extra: 1 }]).success).toBe(false);
      expect(saveUsual([usualRow(0)], { extra: 1 }).success).toBe(false);
      expect(saveUsual([{ ...usualRow(0), extra: 1 }]).success).toBe(false);
    });

    it("confirm defaults to false and must be a boolean", () => {
      const a = saveWeek([weekRow(0)]);
      expect(a.success && a.data.confirm).toBe(false);
      const b = saveUsual([usualRow(0)]);
      expect(b.success && b.data.confirm).toBe(false);
      expect(saveWeek([weekRow(0)], { confirm: "yes" }).success).toBe(false);
      expect(saveUsual([usualRow(0)], { confirm: 1 }).success).toBe(false);
    });

    it("memberId: positive int only; days must be a week plan; usualWeek a week or null", () => {
      for (const memberId of [0, -1, 1.5, "1", null]) {
        expect(saveWeek([{ ...weekRow(0), memberId }]).success).toBe(false);
        expect(saveUsual([{ ...usualRow(0), memberId }]).success).toBe(false);
      }
      expect(saveWeek([{ ...weekRow(0), days: { mon: "x" } }]).success).toBe(false);
      expect(saveUsual([{ ...usualRow(0), usualWeek: { mon: "x" } }]).success).toBe(false);
      expect(saveUsual([{ ...usualRow(0), usualWeek: null }]).success).toBe(true);
      expect(saveUsual([{ memberId: 1, version: VERSION }]).success).toBe(false);
    });
  });

  it("usualWeek may be null (clears it) but not missing-shaped junk", () => {
    expect(schemas.ZSetUsualWeekInput.safeParse({ memberId: 1, usualWeek: null }).success).toBe(true);
    expect(schemas.ZSetUsualWeekInput.safeParse({ memberId: 1, usualWeek: { mon: "x" } }).success).toBe(false);
  });
});

describe("flowko router wiring (Flowko U26)", () => {
  it('ENDPOINTS contains "flowko"', () => {
    expect(ENDPOINTS).toContain("flowko");
  });

  // Flowko U27: bookings.* and business.me joined the flowko router (13 keys); Flowko U28 added six (19 keys);
  // Flowko U29a added six (25 keys); Flowko U29b added roster.saveWeek and roster.saveUsualWeeks (27 keys);
  // Flowko U29c added the five workers.* ones (32 keys).
  it("flowkoRouter serves the roster.* procedures and the U27 ones", () => {
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
        // Flowko U29a (S14): the owner's settings and services (25 keys)
        "business.settings",
        "business.updateSettings",
        "services.list",
        "services.save",
        "services.remove",
        "services.reorder",
        // Flowko U29b (S17): the roster editor's saves (27 keys)
        "roster.saveWeek",
        "roster.saveUsualWeeks",
        // Flowko U29c (W11): the Delavci page (32 keys)
        "workers.list",
        "workers.lock",
        "workers.unlock",
        "workers.addDeskOnly",
        "workers.reorder",
      ].sort()
    );
  });

  it("viewer/_router.tsx mounts it as viewer.flowko", () => {
    const source = readFileSync(resolve(__dirname, "../../_router.tsx"), "utf8");
    expect(source).toContain("flowko: flowkoRouter");
  });
});
