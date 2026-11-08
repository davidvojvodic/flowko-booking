// Flowko U28: the desk read service (Task 2). The day view (every column of the business) and the week view (one
// worker × 7 days) of the business's bookings, the services and members the desk offers, and the customer lookup.
// Privacy first (R1): no response carries a booking uid, an organizer or worker e-mail, a user id or a desk-only
// placeholder address; rows carry the bookingId and server-computed flags, and the desk acts by id. Business
// bookings are the bookings on this business's mirror event types (M6); a column user's other holding bookings
// (Cal's own, or from before they joined, A1) come back as times only („Zasedeno“), with Google busy time fetched
// per column user outside any transaction under a 3 s timeout (R3). Every query selects an explicit field list
// and the number of queries does not grow with the number of columns. Server only.
import { addDays, localDateSchema, todayIn, weekdayOf } from "@calcom/lib/flowkoBusiness/roster";
import { serviceStepsSchema } from "@calcom/lib/flowkoBusiness/schemas";
import {
  busyIntervals,
  dayBounds,
  intersect,
  type Interval,
  type LocalDate,
  normalize,
  roundDownToGrid,
  type ServiceStep,
  totalMinutes,
  trustedSteps,
} from "@calcom/lib/flowkoSalon";
import { phoneDigitsForSearch } from "@calcom/lib/flowkoBusiness/desk";
import isSmsCalEmail from "@calcom/lib/isSmsCalEmail";
import {
  BookingStatus,
  type FlowkoBookingActionKind,
  FlowkoBusinessRole,
  FlowkoMemberStatus,
} from "@calcom/prisma/enums";
import { type BusinessAccess, listMembers, mayOnBooking, requireBusinessAccess } from "./access";
import { type GoogleBusy, googleBusyFor, HOLDING_STATUSES, toExistingBooking } from "./bookingDay";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { type LoadedBusinessDay, loadBusinessDay } from "./roster";

/** R3: how long the desk waits for one column user's Google busy time. */
const GOOGLE_TIMEOUT_MS = 3_000;
/** R11: at most this many customers come back. */
const MAX_CUSTOMERS = 8;
/** R11: attendee rows scanned for the distinct customers (bookings per business are few, phase 1). */
const CUSTOMER_SCAN_LIMIT = 200;
/** R17: the longest lookup query (the route's zod caps it too). */
const MAX_QUERY_LENGTH = 80;
const MAX_INT4 = 2_147_483_647;
const COLUMN_ROLES: FlowkoBusinessRole[] = [FlowkoBusinessRole.OWNER, FlowkoBusinessRole.WORKER];

type GoogleDeps = { googleBusy?: typeof googleBusyFor };

export type DeskBooking = {
  bookingId: number;
  memberId: number;
  status: BookingStatus;
  start: string;
  end: string;
  title: string;
  customer: { name: string; phone: string | null; email: string | null };
  serviceNames: string[];
  serviceIds: number[] | null;
  steps: Array<{ kind: "busy" | "processing"; start: string; end: string; serviceName: string }> | null;
  noShow: boolean;
  mayCancel: boolean;
  mayMove: boolean;
  mayNoShow: boolean;
  mayReenter: boolean;
  actions: Array<{ kind: FlowkoBookingActionKind; actorName: string | null; at: string; details: unknown }>;
};
export type DeskColumn = {
  memberId: number;
  displayName: string;
  deskOnly: boolean;
  isMe: boolean;
  locked: boolean;
  shifts: Interval[];
  timeOff: Interval[];
  otherBusy: Interval[];
  googleUnavailable: boolean;
};
export type DeskDay = {
  date: LocalDate;
  opening: Interval[];
  holiday: { name: string; open: boolean } | null;
  columns: DeskColumn[];
  bookings: DeskBooking[];
};
export type DeskView = {
  timeZone: string;
  slotStepMinutes: number;
  now: string;
  me: { memberId: number; role: FlowkoBusinessRole };
  days: DeskDay[];
};
export type DeskService = {
  id: number;
  name: string;
  category: string | null;
  steps: ServiceStep[];
  totalMinutes: number;
  workerMemberIds: number[];
};
export type DeskMember = {
  memberId: number;
  displayName: string;
  role: FlowkoBusinessRole;
  hasColumn: boolean;
  deskOnly: boolean;
};
export type DeskCustomer = { name: string; phone: string | null; email: string | null };

/** A member as the views need it; userId and createdAt stay inside this module. */
type MemberRow = {
  memberId: number;
  userId: number | null;
  displayName: string;
  role: FlowkoBusinessRole;
  status: FlowkoMemberStatus;
  deskOnly: boolean;
  memberSince: Date;
};

/** Which columns a view shows: every one (day view) or one member's (week view). */
type ColumnFilter = { memberId: number } | null;

async function businessTimeZone(db: FlowkoDb, businessId: number): Promise<string> {
  const business = await db.flowkoBusiness.findUnique({
    where: { id: businessId },
    select: { timeZone: true },
  });
  if (!business) throw new FlowkoBusinessError("forbidden");
  return business.timeZone;
}

/** Every member of the business with the fields the views need (LOCKED included), in roster order. */
async function membersOf(db: FlowkoDb, businessId: number): Promise<MemberRow[]> {
  const [views, joined] = await Promise.all([
    listMembers(db, businessId),
    db.flowkoBusinessMember.findMany({ where: { businessId }, select: { id: true, createdAt: true } }),
  ]);
  const since = new Map(joined.map((m) => [m.id, m.createdAt]));
  return views.map((m) => {
    const memberSince = since.get(m.memberId);
    if (!memberSince) throw new Error("Flowko U28: member vanished between two reads");
    return {
      memberId: m.memberId,
      userId: m.userId,
      displayName: m.displayName,
      role: m.role,
      status: m.status,
      deskOnly: m.deskOnly,
      memberSince,
    };
  });
}

/**
 * R3: one user's Google busy time for the whole range, never longer than 3 s. A failure (googleBusyFor's
 * whole-range `unavailable` block, a rejection or the timeout) is unavailable with no Google block at all.
 */
async function googleWithTimeout(
  googleBusy: typeof googleBusyFor,
  userId: number,
  range: Interval
): Promise<GoogleBusy> {
  const unavailable: GoogleBusy = { busy: [], unavailable: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<GoogleBusy>((resolve) => {
    timer = setTimeout(() => resolve(unavailable), GOOGLE_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([googleBusy(userId, range).catch(() => unavailable), timeout]);
    return result.unavailable ? unavailable : { busy: result.busy, unavailable: false };
  } finally {
    clearTimeout(timer);
  }
}

type BookingRow = {
  id: number;
  status: BookingStatus;
  startTime: Date;
  endTime: Date;
  title: string;
  userId: number | null;
  eventTypeId: number | null;
  createdAt: Date;
  attendees: Array<{ name: string; email: string; phoneNumber: string | null; noShow: boolean | null }>;
  flowkoBookingSteps: Array<{
    index: number;
    kind: "busy" | "processing";
    startTime: Date;
    endTime: Date;
    serviceId: number | null;
    serviceName: string;
  }>;
  flowkoBookingActions: Array<{
    action: FlowkoBookingActionKind;
    actorName: string;
    createdAt: Date;
    details: unknown;
  }>;
};

/** R5: the per-row flags; the server routes re-check every one of them. */
function rowFlags(
  access: BusinessAccess,
  booking: BookingRow,
  worker: MemberRow,
  act: boolean,
  now: Date
): Pick<DeskBooking, "mayCancel" | "mayMove" | "mayNoShow" | "mayReenter"> {
  const nowMs = now.getTime();
  const notOver = booking.endTime.getTime() > nowMs;
  const accepted = booking.status === BookingStatus.ACCEPTED;
  const mayCancel = act && (HOLDING_STATUSES as BookingStatus[]).includes(booking.status) && notOver;
  return {
    mayCancel,
    mayMove: act && accepted && worker.status === FlowkoMemberStatus.ACTIVE && notOver,
    mayNoShow: act && accepted && booking.startTime.getTime() <= nowMs,
    mayReenter:
      mayCancel && (access.role === FlowkoBusinessRole.OWNER || access.role === FlowkoBusinessRole.STAFF),
  };
}

/** R2: the row of one business booking, without the uid, the organizer or any user id. */
function toDeskBooking(
  access: BusinessAccess,
  booking: BookingRow,
  worker: MemberRow,
  act: boolean,
  now: Date
): DeskBooking {
  const stepRows = booking.flowkoBookingSteps;
  const existing = toExistingBooking({
    startTime: booking.startTime,
    endTime: booking.endTime,
    steps: stepRows,
  });
  const serviceIds = stepRows.map((s) => s.serviceId);
  const attendee = booking.attendees[0];
  return {
    bookingId: booking.id,
    memberId: worker.memberId,
    status: booking.status,
    start: booking.startTime.toISOString(),
    end: booking.endTime.toISOString(),
    title: booking.title,
    customer: {
      name: attendee?.name ?? "",
      phone: attendee?.phoneNumber ?? null,
      email: attendee && !isSmsCalEmail(attendee.email) ? attendee.email : null,
    },
    serviceNames: Array.from(new Set(stepRows.map((s) => s.serviceName))),
    serviceIds:
      serviceIds.length === 0 || serviceIds.some((id) => id === null)
        ? null
        : Array.from(new Set(serviceIds as number[])),
    // U24 E2: an untrusted copy (a span the steps no longer cover) is drawn solid.
    steps: trustedSteps(existing)
      ? stepRows.map((s) => ({
          kind: s.kind,
          start: s.startTime.toISOString(),
          end: s.endTime.toISOString(),
          serviceName: s.serviceName,
        }))
      : null,
    noShow: booking.attendees.some((a) => a.noShow === true),
    ...rowFlags(access, booking, worker, act, now),
    actions: booking.flowkoBookingActions.map((a) => ({
      kind: a.action,
      actorName: a.actorName,
      at: a.createdAt.toISOString(),
      details: a.details ?? null,
    })),
  };
}

/** Busy time of a booking that is not a row: its busy steps when its copy is trusted, else its span. */
function busyOf(b: {
  startTime: Date;
  endTime: Date;
  flowkoBookingSteps: Array<{ index: number; kind: "busy" | "processing"; startTime: Date; endTime: Date }>;
}): Interval[] {
  const existing = toExistingBooking({ startTime: b.startTime, endTime: b.endTime, steps: b.flowkoBookingSteps });
  return trustedSteps(existing) ? busyIntervals(existing.steps) : [{ start: existing.start, end: existing.end }];
}

/**
 * The shared core of the day and week views: per date the roster (loadBusinessDay), then once for the whole range
 * the members, the mirrors, the business bookings, the column users' other bookings and Google. LOCKED members
 * with visible bookings on a date get a read-only column at the end (R4).
 */
async function buildView(
  db: FlowkoDb,
  access: BusinessAccess,
  dates: LocalDate[],
  filter: ColumnFilter,
  now: Date,
  deps: GoogleDeps
): Promise<DeskView> {
  const timeZone = await businessTimeZone(db, access.businessId);
  const loaded: LoadedBusinessDay[] = [];
  for (const date of dates) loaded.push(await loadBusinessDay(db, access.businessId, date));
  const range: Interval = { start: loaded[0].rules.day.start, end: loaded[loaded.length - 1].rules.day.end };
  const slotStepMinutes = loaded[0].rules.slotStepMinutes;

  const members = await membersOf(db, access.businessId);
  const byMember = new Map(members.map((m) => [m.memberId, m]));
  const wanted = (memberId: number) => filter === null || filter.memberId === memberId;

  const mirrors = await db.flowkoWorkerMirror.findMany({
    where: { businessId: access.businessId },
    select: { eventTypeId: true, memberId: true },
  });
  const mirrorMember = new Map(mirrors.map((m) => [m.eventTypeId, m.memberId]));

  const businessRows: BookingRow[] =
    mirrors.length === 0
      ? []
      : await db.booking.findMany({
          where: {
            eventTypeId: { in: mirrors.map((m) => m.eventTypeId) },
            status: { in: HOLDING_STATUSES },
            startTime: { lt: new Date(range.end) },
            endTime: { gt: new Date(range.start) },
          },
          select: {
            id: true,
            status: true,
            startTime: true,
            endTime: true,
            title: true,
            userId: true,
            eventTypeId: true,
            createdAt: true,
            attendees: {
              select: { name: true, email: true, phoneNumber: true, noShow: true },
              orderBy: { id: "asc" },
            },
            flowkoBookingSteps: {
              select: {
                index: true,
                kind: true,
                startTime: true,
                endTime: true,
                serviceId: true,
                serviceName: true,
              },
              orderBy: { index: "asc" },
            },
            flowkoBookingActions: {
              select: { action: true, actorName: true, createdAt: true, details: true },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
          },
          orderBy: [{ startTime: "asc" }, { id: "asc" }],
        });

  // Rows the actor may see (A1: a booking from before its organizer joined is not the business's).
  const rows: Array<{ booking: BookingRow; worker: MemberRow; row: DeskBooking }> = [];
  for (const booking of businessRows) {
    const memberId = booking.eventTypeId === null ? undefined : mirrorMember.get(booking.eventTypeId);
    const worker = memberId === undefined ? undefined : byMember.get(memberId);
    if (!worker || booking.userId === null || !wanted(worker.memberId)) continue;
    const organizer = {
      userId: booking.userId,
      // The mirror's member is the organizer; any other organizer fails closed.
      businessId: worker.userId === booking.userId ? access.businessId : null,
      memberSince: worker.memberSince,
    };
    if (!mayOnBooking(access, organizer, booking, "see")) continue;
    const act = mayOnBooking(access, organizer, booking, "act");
    rows.push({ booking, worker, row: toDeskBooking(access, booking, worker, act, now) });
  }
  const rowIds = new Set(rows.map((r) => r.booking.id));

  // Columns: the active ones of each date, then LOCKED (or otherwise column-less) members with rows that date.
  const activeIds = new Set(loaded.flatMap((d) => d.workers.map((w) => w.memberId)));
  const extraMembers = members.filter(
    (m) =>
      COLUMN_ROLES.includes(m.role) &&
      !activeIds.has(m.memberId) &&
      wanted(m.memberId) &&
      (filter !== null || rows.some((r) => r.worker.memberId === m.memberId))
  );
  const columnUsers = new Map<number, number>(); // memberId → userId
  for (const d of loaded) {
    for (const w of d.workers) if (wanted(w.memberId)) columnUsers.set(w.memberId, w.userId);
  }
  for (const m of extraMembers) if (m.userId !== null) columnUsers.set(m.memberId, m.userId);
  const userIds = Array.from(new Set(columnUsers.values()));

  // R3: the column users' holding bookings that are not rows (Cal's own, another business's, pre-join): times only.
  const others =
    userIds.length === 0
      ? []
      : await db.booking.findMany({
          where: {
            userId: { in: userIds },
            status: { in: HOLDING_STATUSES },
            startTime: { lt: new Date(range.end) },
            endTime: { gt: new Date(range.start) },
          },
          select: {
            id: true,
            userId: true,
            eventTypeId: true,
            startTime: true,
            endTime: true,
            flowkoBookingSteps: {
              select: { index: true, kind: true, startTime: true, endTime: true },
              orderBy: { index: "asc" },
            },
          },
        });
  const otherBusyByUser = new Map<number, Interval[]>();
  for (const b of others) {
    if (b.userId === null || rowIds.has(b.id)) continue;
    otherBusyByUser.set(b.userId, [...(otherBusyByUser.get(b.userId) ?? []), ...busyOf(b)]);
  }

  // R3: Google per column user, outside any transaction, at most 3 s; desk-only and LOCKED users are not asked.
  const googleBusy = deps.googleBusy ?? googleBusyFor;
  const askGoogle = Array.from(
    new Set(
      loaded.flatMap((d) =>
        d.workers.filter((w) => wanted(w.memberId) && !byMember.get(w.memberId)?.deskOnly).map((w) => w.userId)
      )
    )
  );
  const google = new Map<number, GoogleBusy>();
  await Promise.all(
    askGoogle.map(async (userId) => {
      google.set(userId, await googleWithTimeout(googleBusy, userId, range));
    })
  );

  const column = (
    memberId: number,
    userId: number | null,
    day: Interval,
    roster: { shifts: Interval[]; timeOff: Interval[] },
    locked: boolean
  ): DeskColumn => {
    const member = byMember.get(memberId);
    const g = userId === null ? undefined : google.get(userId);
    const busy = userId === null ? [] : [...(otherBusyByUser.get(userId) ?? []), ...(g?.busy ?? [])];
    return {
      memberId,
      displayName: member?.displayName ?? "",
      deskOnly: member?.deskOnly ?? false,
      isMe: memberId === access.memberId,
      locked,
      shifts: roster.shifts,
      timeOff: roster.timeOff,
      otherBusy: intersect(normalize(busy), [day]),
      googleUnavailable: g?.unavailable ?? false,
    };
  };

  const days = loaded.map((d): DeskDay => {
    const day = d.rules.day;
    const dayRows = rows.filter(
      (r) => r.booking.startTime.getTime() < day.end && r.booking.endTime.getTime() > day.start
    );
    const active = d.workers
      .filter((w) => wanted(w.memberId))
      .map((w) => column(w.memberId, w.userId, day, w, false));
    const extra = extraMembers
      .filter((m) => filter !== null || dayRows.some((r) => r.worker.memberId === m.memberId))
      .map((m) =>
        column(m.memberId, m.userId, day, { shifts: [], timeOff: [] }, m.status === FlowkoMemberStatus.LOCKED)
      );
    return {
      date: d.date,
      opening: d.rules.opening,
      holiday: d.holiday,
      columns: [...active, ...extra],
      bookings: dayRows.map((r) => r.row),
    };
  });

  const today = dayBounds(todayIn(timeZone, now), timeZone);
  return {
    timeZone,
    slotStepMinutes,
    now: new Date(roundDownToGrid(now, today, slotStepMinutes)).toISOString(),
    me: { memberId: access.memberId, role: access.role },
    days,
  };
}

/** The day view: every column of the business on `date` (R2–R4). Any business access. */
export async function getDeskDay(
  db: FlowkoDb,
  actorUserId: number,
  input: { date: LocalDate },
  now: Date,
  deps: GoogleDeps = {}
): Promise<DeskView> {
  const access = await requireBusinessAccess(db, actorUserId);
  const parsed = localDateSchema.safeParse(input.date);
  if (!parsed.success) throw new FlowkoBusinessError("bad_roster");
  return buildView(db, access, [parsed.data], null, now, deps);
}

/**
 * The week view (D2): one column member × the 7 days from Monday `weekStart` (else bad_roster). A member of
 * another business (or none) is forbidden, a STAFF member (no column) bad_member; a LOCKED member shows as their
 * read-only locked column. Google is asked once for the whole week.
 */
export async function getDeskWeek(
  db: FlowkoDb,
  actorUserId: number,
  input: { weekStart: LocalDate; memberId: number },
  now: Date,
  deps: GoogleDeps = {}
): Promise<DeskView> {
  const access = await requireBusinessAccess(db, actorUserId);
  const parsed = localDateSchema.safeParse(input.weekStart);
  if (!parsed.success || weekdayOf(parsed.data) !== "mon") throw new FlowkoBusinessError("bad_roster");
  const memberId = input.memberId;
  if (!Number.isInteger(memberId) || memberId <= 0 || memberId > MAX_INT4) {
    throw new FlowkoBusinessError("forbidden");
  }
  const member = await db.flowkoBusinessMember.findUnique({
    where: { id: memberId },
    select: { businessId: true, role: true },
  });
  if (!member || member.businessId !== access.businessId) throw new FlowkoBusinessError("forbidden");
  if (!COLUMN_ROLES.includes(member.role)) throw new FlowkoBusinessError("bad_member");
  const dates = Array.from({ length: 7 }, (_, i) => addDays(parsed.data, i));
  return buildView(db, access, dates, { memberId }, now, deps);
}

/** The business's services in position order with their steps and the members who perform them. */
export async function listDeskServices(db: FlowkoDb, actorUserId: number): Promise<DeskService[]> {
  const access = await requireBusinessAccess(db, actorUserId);
  const services = await db.flowkoService.findMany({
    where: { businessId: access.businessId },
    select: { id: true, name: true, category: true, steps: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  // Through the relation, never `serviceId: { in }` (prismock returns nothing for `in` on this composite key).
  const assignments = await db.flowkoServiceWorker.findMany({
    where: { service: { businessId: access.businessId } },
    select: { serviceId: true, memberId: true },
  });
  return services.map((s) => {
    const steps = serviceStepsSchema.safeParse(s.steps);
    // Stored steps are validated on write; a failure here is corrupt data.
    if (!steps.success) throw new Error("Flowko U28: stored service steps invalid");
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      steps: steps.data,
      totalMinutes: totalMinutes(steps.data),
      workerMemberIds: assignments
        .filter((a) => a.serviceId === s.id)
        .map((a) => a.memberId)
        .sort((x, y) => x - y),
    };
  });
}

/** The ACTIVE members of the business in roster order (staff and desk-only included), without user ids. */
export async function listDeskMembers(db: FlowkoDb, actorUserId: number): Promise<DeskMember[]> {
  const access = await requireBusinessAccess(db, actorUserId);
  const members = await listMembers(db, access.businessId);
  return members
    .filter((m) => m.status === FlowkoMemberStatus.ACTIVE)
    .map((m) => ({
      memberId: m.memberId,
      displayName: m.displayName,
      role: m.role,
      hasColumn: m.hasColumn,
      deskOnly: m.deskOnly,
    }));
}

/**
 * R11: the customers this business has served (attendees of its mirror bookings, any status) whose name contains
 * the query (case-insensitive) or whose phone contains its digits (phoneDigitsForSearch: a query with letters is
 * a name search). Query trimmed; fewer than 2 letters and fewer than 3 digits → []. Distinct by (lower(name),
 * phone, e-mail), newest first, at most 8; `{ name, phone, email }` only, an @sms.cal.com address as null.
 */
export async function findCustomers(
  db: FlowkoDb,
  actorUserId: number,
  input: { query: string }
): Promise<DeskCustomer[]> {
  const access = await requireBusinessAccess(db, actorUserId);
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length > MAX_QUERY_LENGTH) return [];
  const digits = phoneDigitsForSearch(query);
  // A letter has a case (no `u` regex flag: the trpc build targets ES5); covers č, š, ž.
  const letters = Array.from(query).filter((ch) => ch.toLowerCase() !== ch.toUpperCase()).length;
  if (digits === null && letters < 2) return [];

  const mirrors = await db.flowkoWorkerMirror.findMany({
    where: { businessId: access.businessId },
    select: { eventTypeId: true },
  });
  if (mirrors.length === 0) return [];
  const attendees = await db.attendee.findMany({
    where: {
      booking: { eventTypeId: { in: mirrors.map((m) => m.eventTypeId) } },
      // „has a phone and it contains the digits“ as NOT (no phone OR NOT contains): the same SQL meaning, and
      // prismock's OR stops at the first match, so it never runs `contains` on a null phone (it would throw).
      ...(digits !== null
        ? { NOT: { OR: [{ phoneNumber: null }, { NOT: { phoneNumber: { contains: digits } } }] } }
        : { name: { contains: query, mode: "insensitive" as const } }),
    },
    select: { name: true, email: true, phoneNumber: true },
    orderBy: { id: "desc" },
    take: CUSTOMER_SCAN_LIMIT,
  });

  const seen = new Set<string>();
  const out: DeskCustomer[] = [];
  for (const a of attendees) {
    const customer: DeskCustomer = {
      name: a.name,
      phone: a.phoneNumber ?? null,
      email: isSmsCalEmail(a.email) ? null : a.email,
    };
    const key = JSON.stringify([customer.name.toLowerCase(), customer.phone, customer.email]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(customer);
    if (out.length === MAX_CUSTOMERS) break;
  }
  return out;
}
