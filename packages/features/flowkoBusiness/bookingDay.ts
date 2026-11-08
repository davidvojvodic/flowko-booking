// Flowko U27: what the booking writer (Task 5) and the free-starts API (Task 8) read before they place a visit:
// a worker's existing bookings of a day mapped to the U24 engine's ExistingBooking, the worker's Google busy
// time, the grid rounding of "now" (E4), the services of a visit (W5) and the free-starts service itself. The
// U24 engine decides whether a booking's step copy is trusted (availability.ts); this module only maps rows.
// Google code is loaded lazily so the module stays cheap to import. Server only.

import type { getBusyCalendarTimes } from "@calcom/features/calendars/lib/CalendarManager";
import { serviceStepsSchema } from "@calcom/lib/flowkoBusiness/schemas";
import {
  concatServices,
  type ExistingBooking,
  freeStarts,
  type Interval,
  type LocalDate,
  type PlacedStep,
  type ServiceStep,
} from "@calcom/lib/flowkoSalon";
import logger from "@calcom/lib/logger";
import { BookingStatus } from "@calcom/prisma/enums";
import { requireBusinessAccess } from "./access";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { loadBusinessDay } from "./roster";

const MINUTE_MS = 60_000;
const MAX_SERVICES_PER_VISIT = 5;
/** W3: bookings in these states hold the worker's time. */
const HOLDING_STATUSES = [BookingStatus.ACCEPTED, BookingStatus.PENDING, BookingStatus.AWAITING_HOST];

const log = logger.getSubLogger({ prefix: ["flowko-booking-day"] });

export type StepCopyRow = { index: number; kind: "busy" | "processing"; startTime: Date; endTime: Date };

/** A booking row and its step rows as the engine's ExistingBooking; no rows = no `steps` (blocks its whole span). */
export function toExistingBooking(b: {
  startTime: Date;
  endTime: Date;
  steps: StepCopyRow[];
}): ExistingBooking {
  const existing: ExistingBooking = { start: b.startTime.getTime(), end: b.endTime.getTime() };
  if (b.steps.length > 0) {
    existing.steps = b.steps.map(
      (s): PlacedStep => ({
        index: s.index,
        kind: s.kind,
        start: s.startTime.getTime(),
        end: s.endTime.getTime(),
      })
    );
  }
  return existing;
}

/**
 * W3: the user's ACCEPTED, PENDING and AWAITING_HOST bookings that overlap `day` (startTime < day.end and
 * endTime > day.start), with their step copies ordered by index; `exceptBookingId` leaves one booking out (a
 * move must not collide with itself). Every booking of the user counts, business or Cal's own.
 */
export async function loadWorkerBookings(
  db: FlowkoDb,
  userId: number,
  day: Interval,
  exceptBookingId?: number
): Promise<ExistingBooking[]> {
  const rows = await db.booking.findMany({
    where: {
      userId,
      status: { in: HOLDING_STATUSES },
      startTime: { lt: new Date(day.end) },
      endTime: { gt: new Date(day.start) },
      ...(exceptBookingId !== undefined && { id: { not: exceptBookingId } }),
    },
    select: {
      startTime: true,
      endTime: true,
      flowkoBookingSteps: {
        select: { index: true, kind: true, startTime: true, endTime: true },
        orderBy: { index: "asc" },
      },
    },
    orderBy: { startTime: "asc" },
  });
  return rows.map((row) =>
    toExistingBooking({ startTime: row.startTime, endTime: row.endTime, steps: row.flowkoBookingSteps })
  );
}

export type GoogleBusy = { busy: Interval[]; unavailable: boolean };

/** What goes wrong with Google is logged by class only: messages can quote calendar names or addresses. */
function failedGoogle(day: Interval, reason: string): GoogleBusy {
  log.warn("google busy unavailable", { reason });
  return { busy: [day], unavailable: true };
}

/**
 * The user's busy time from their connected calendars for `day`, mode "slots", user-level selected calendars.
 * No calendar credential: nothing busy and available. A failed or thrown fetch fails closed: the whole day busy
 * and `unavailable` (the desk may book anyway, the writer decides). The Google code is imported lazily.
 */
export async function googleBusyFor(
  userId: number,
  day: Interval,
  deps: { getBusy?: typeof getBusyCalendarTimes } = {}
): Promise<GoogleBusy> {
  try {
    const { getUsersCredentialsIncludeServiceAccountKey } = await import(
      "@calcom/app-store/delegationCredential"
    );
    const credentials = (await getUsersCredentialsIncludeServiceAccountKey({ id: userId, email: "" })).filter(
      (c) => c.type.endsWith("_calendar")
    );
    if (credentials.length === 0) return { busy: [], unavailable: false };

    const getBusy =
      deps.getBusy ?? (await import("@calcom/features/calendars/lib/CalendarManager")).getBusyCalendarTimes;
    const { SelectedCalendarRepository } = await import(
      "@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository"
    );
    const selectedCalendars = await SelectedCalendarRepository.findManyUserLevel({ where: { userId } });

    const result = await getBusy(
      credentials,
      new Date(day.start).toISOString(),
      new Date(day.end).toISOString(),
      selectedCalendars,
      "slots"
    );
    if (!result.success) return failedGoogle(day, "fetch_failed");
    const busy: Interval[] = [];
    for (const item of result.data) {
      const start = new Date(item.start).getTime();
      const end = new Date(item.end).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) busy.push({ start, end });
    }
    return { busy, unavailable: false };
  } catch (error) {
    return failedGoogle(day, error instanceof Error ? error.name : typeof error);
  }
}

/** E4: `now` rounded down to the business grid anchored at the day's start, as epoch ms. */
export function roundDownToGrid(now: Date, day: Interval, stepMinutes: number): number {
  const stepMs = stepMinutes * MINUTE_MS;
  return day.start + Math.floor((now.getTime() - day.start) / stepMs) * stepMs;
}

export type ServiceForBooking = { id: number; name: string; steps: ServiceStep[] };

function distinctIdsOrFail(serviceIds: number[]): void {
  if (
    serviceIds.length < 1 ||
    serviceIds.length > MAX_SERVICES_PER_VISIT ||
    !serviceIds.every((id) => Number.isInteger(id) && id > 0) ||
    new Set(serviceIds).size !== serviceIds.length
  ) {
    throw new FlowkoBusinessError("bad_booking");
  }
}

/** The business's services in input order; an unknown id or another business's id is bad_booking. */
async function readServices(
  db: FlowkoDb,
  businessId: number,
  serviceIds: number[]
): Promise<ServiceForBooking[]> {
  distinctIdsOrFail(serviceIds);
  const rows = await db.flowkoService.findMany({
    where: { id: { in: serviceIds }, businessId },
    select: { id: true, name: true, steps: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return serviceIds.map((id) => {
    const row = byId.get(id);
    if (!row) throw new FlowkoBusinessError("bad_booking");
    const steps = serviceStepsSchema.safeParse(row.steps);
    // Stored steps are validated on write; a failure here is corrupt data, not a bad request.
    if (!steps.success) throw new Error("Flowko U27: stored service steps invalid");
    return { id: row.id, name: row.name, steps: steps.data };
  });
}

/** For each member: how many of `serviceIds` the member performs. */
async function assignedServiceCounts(db: FlowkoDb, serviceIds: number[]): Promise<Map<number, number>> {
  // At most five ids; OR of equalities rather than `in` (prismock returns nothing for `in` on this composite-key model).
  const rows = await db.flowkoServiceWorker.findMany({
    where: { OR: serviceIds.map((serviceId) => ({ serviceId })) },
    select: { memberId: true, serviceId: true },
  });
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.memberId, (counts.get(row.memberId) ?? 0) + 1);
  return counts;
}

/**
 * W5: the visit's 1–5 distinct services of the business, in input order, all assigned to the worker. Duplicates,
 * unknown ids and another business's ids are bad_booking; a service the worker does not perform is
 * service_not_assigned.
 */
export async function loadServicesForWorker(
  db: FlowkoDb,
  businessId: number,
  memberId: number,
  serviceIds: number[]
): Promise<ServiceForBooking[]> {
  const services = await readServices(db, businessId, serviceIds);
  const counts = await assignedServiceCounts(db, serviceIds);
  if ((counts.get(memberId) ?? 0) !== serviceIds.length)
    throw new FlowkoBusinessError("service_not_assigned");
  return services;
}

/** The visit's steps back to back in input order; every step carries its service's id as serviceRef. */
export function combinedSteps(services: ServiceForBooking[]): ServiceStep[] {
  return concatServices(services.map((s) => s.steps.map((step) => ({ ...step, serviceRef: String(s.id) }))));
}

export type FreeStartsView = {
  date: LocalDate;
  timeZone: string;
  slotStepMinutes: number;
  holiday: { name: string; open: boolean } | null;
  workers: Array<{ memberId: number; displayName: string; starts: string[]; googleUnavailable: boolean }>;
};

/**
 * The free starts of a day for a visit, per column worker who performs every requested service. Rights: any
 * business access (owner, worker, staff); a stranger gets forbidden. The business grid is used; `now` is rounded
 * down to it and the notice is 0 (E4). Each worker's bookings and Google busy time are read per call.
 */
export async function getFreeStarts(
  db: FlowkoDb,
  actorUserId: number,
  input: { date: LocalDate; serviceIds: number[] },
  now: Date,
  deps: { googleBusy?: typeof googleBusyFor } = {}
): Promise<FreeStartsView> {
  const access = await requireBusinessAccess(db, actorUserId);
  const services = await readServices(db, access.businessId, input.serviceIds);
  const counts = await assignedServiceCounts(
    db,
    services.map((s) => s.id)
  );
  const steps = combinedSteps(services);

  const business = await db.flowkoBusiness.findUnique({
    where: { id: access.businessId },
    select: { timeZone: true },
  });
  if (!business) throw new FlowkoBusinessError("forbidden");
  const loaded = await loadBusinessDay(db, access.businessId, input.date);
  const rules = {
    ...loaded.rules,
    minimumNoticeMinutes: 0,
    now: roundDownToGrid(now, loaded.rules.day, loaded.rules.slotStepMinutes),
  };
  const googleBusy = deps.googleBusy ?? googleBusyFor;

  const eligible = loaded.workers.filter((w) => counts.get(w.memberId) === services.length);
  const workers = await Promise.all(
    eligible.map(async (w) => {
      const [bookings, google] = await Promise.all([
        loadWorkerBookings(db, w.userId, loaded.rules.day),
        googleBusy(w.userId, loaded.rules.day),
      ]);
      const starts = freeStarts(
        { shifts: w.shifts, timeOff: w.timeOff, bookings, externalBusy: google.busy },
        steps,
        rules
      );
      return {
        memberId: w.memberId,
        displayName: w.displayName,
        starts: starts.map((ms) => new Date(ms).toISOString()),
        googleUnavailable: google.unavailable,
      };
    })
  );

  return {
    date: loaded.date,
    timeZone: business.timeZone,
    slotStepMinutes: loaded.rules.slotStepMinutes,
    holiday: loaded.holiday,
    workers,
  };
}
