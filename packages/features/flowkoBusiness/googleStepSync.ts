// Flowko U30: keeps a worker's Google calendar in line with her salon appointments. For a business booking the
// sync recomputes what Google should hold (one event per busy step of an ACCEPTED booking that has not ended,
// nothing for any other state) and puts or deletes by the deterministic event id (googleStepEvents.ts), so it needs
// no table: a re-run, a move or a reconnected account all end in the same calendar. The calls go through the raw
// Google client of the worker's credential (never Cal's createEvent/updateEvent, which add guests): no guests, and
// `sendUpdates: "none"` on every call. Nothing here throws and a Google failure never touches the booking; errors
// are logged by class and HTTP code only (no customer data, no calendar id, no Google message). The app store is
// imported lazily, and only when the worker has a valid Google credential, so a business without Google costs one
// small query. Server only.
import type { calendar_v3 } from "@googleapis/calendar";
import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { BookingStatus } from "@calcom/prisma/enums";
import type { FlowkoDb } from "./db";
import { allStepEventIds, type StepEvent, stepEventsFor } from "./googleStepEvents";
import { businessBookingById, mirrorIdsOfUser } from "./mirror";

const GOOGLE_CALENDAR = "google_calendar";
const log = logger.getSubLogger({ prefix: ["flowko-google-step-sync"] });

export type StepCalendar = {
  calendarId: string;
  events: Pick<calendar_v3.Resource$Events, "insert" | "update" | "delete">;
};
export type GoogleSyncResult = "none" | "synced" | "failed";

type TargetDeps = { target?: typeof googleTargetFor };

/** The HTTP status of a Google error (a number, or the numeric string some client versions use), else undefined. */
function httpCode(error: unknown): number | undefined {
  const { code, status, response } = (error ?? {}) as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  for (const value of [code, status, response?.status]) {
    const number = typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : value;
    if (typeof number === "number" && Number.isInteger(number) && number >= 100 && number <= 599)
      return number;
  }
  return undefined;
}

// Flowko U30: R8
const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
]);

/** R8: Google refuses this connection for good (grant revoked or expired, no access to the calendar). */
function isRefusedForGood(error: unknown): boolean {
  const code = httpCode(error);
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data as
    | { error?: unknown }
    | undefined;
  if (code === 401) return true;
  if (code === 400 && data?.error === "invalid_grant") return true;
  if (code !== 403) return false;
  const reason = (data?.error as { errors?: Array<{ reason?: unknown }> } | undefined)?.errors?.[0]?.reason;
  return !(typeof reason === "string" && RATE_LIMIT_REASONS.has(reason));
}

/** The error's class and HTTP code only: messages from Google can quote addresses and calendar names. */
function loggable(error: unknown): { errorClass: string; httpCode?: number } {
  const { name } = (error ?? {}) as { name?: unknown };
  const code = httpCode(error);
  return {
    errorClass: typeof name === "string" ? name : typeof error,
    ...(code !== undefined && { httpCode: code }),
  };
}

/**
 * R2: the calendar a worker's step events go to. Her destination calendar when it is a Google calendar of one of
 * her valid google_calendar credentials; else her first valid credential (lowest id) and "primary". null = she has
 * no valid Google credential: decided through `db` before anything of the app store is loaded.
 */
export async function googleTargetFor(db: FlowkoDb, userId: number): Promise<StepCalendar | null> {
  const stored = await db.credential.findMany({
    where: { userId, type: GOOGLE_CALENDAR },
    select: { id: true, invalid: true },
  });
  if (!stored.some((credential) => credential.invalid !== true)) return null;

  const { getUsersCredentialsIncludeServiceAccountKey } = await import(
    "@calcom/app-store/delegationCredential"
  );
  const credentials = (await getUsersCredentialsIncludeServiceAccountKey({ id: userId, email: "" })).filter(
    (credential) => credential.type === GOOGLE_CALENDAR && credential.invalid !== true
  );
  if (credentials.length === 0) return null;

  const destination = await db.destinationCalendar.findUnique({
    where: { userId },
    select: { integration: true, externalId: true, credentialId: true },
  });
  const wanted =
    destination !== null && destination.integration === GOOGLE_CALENDAR
      ? credentials.find((credential) => credential.id === destination.credentialId)
      : undefined;
  const credential = wanted ?? credentials[0];
  const calendarId =
    wanted && destination && destination.externalId !== "" ? destination.externalId : "primary";

  const { createGoogleCalendarServiceWithGoogleType } = await import(
    "@calcom/app-store/googlecalendar/lib/CalendarService"
  );
  const calendar = await createGoogleCalendarServiceWithGoogleType(
    credential as Parameters<typeof createGoogleCalendarServiceWithGoogleType>[0]
  ).authedCalendar();
  return { calendarId, events: calendar.events };
}

/** R4: update the event; 404 → insert it with its id; 409 on the insert → update once more. */
async function putEvent(target: StepCalendar, event: StepEvent): Promise<void> {
  const requestBody = { ...event, status: "confirmed" };
  const update = () =>
    target.events.update({
      calendarId: target.calendarId,
      eventId: event.id,
      requestBody,
      sendUpdates: "none",
    });
  try {
    await update();
  } catch (error) {
    if (httpCode(error) !== 404) throw error;
    try {
      await target.events.insert({ calendarId: target.calendarId, requestBody, sendUpdates: "none" });
    } catch (insertError) {
      if (httpCode(insertError) !== 409) throw insertError;
      await update();
    }
  }
}

/** R4: delete the event; 404 and 410 (already gone) count as done. */
async function deleteEvent(target: StepCalendar, eventId: string): Promise<void> {
  try {
    await target.events.delete({ calendarId: target.calendarId, eventId, sendUpdates: "none" });
  } catch (error) {
    const code = httpCode(error);
    if (code !== 404 && code !== 410) throw error;
  }
}

/**
 * Runs every job, one after the other; a failed one is logged (class and code) and the rest still run.
 * Returns the errors of the failed jobs (empty = all done).
 */
async function runAll(
  jobs: Array<{ label: string; run: () => Promise<void> }>,
  bookingId?: number
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const job of jobs) {
    try {
      await job.run();
    } catch (error) {
      errors.push(error);
      log.error(job.label, { ...(bookingId !== undefined && { bookingId }), ...loggable(error) });
    }
  }
  return errors;
}

/**
 * R3/R4: brings Google in line with one booking. Not a business booking, or a worker without a valid Google
 * credential: "none". An ACCEPTED booking that has not ended: every busy step's event is put (a processing step
 * never gets one, so the gap stays free); any other state: every step id is deleted. A failed step does not stop
 * the others ("failed" at the end). An ACCEPTED booking that has ended: "none". Never throws.
 * Flowko U30: two changes to one booking can run at the same time; when the booking's state or start changed while
 * the events were being put, the sync runs once more (`attempt`: private, at most one re-run).
 */
export async function syncBookingStepEvents(
  db: FlowkoDb,
  bookingId: number,
  now: Date,
  deps: TargetDeps = {},
  attempt = 0
): Promise<GoogleSyncResult> {
  try {
    const ref = await businessBookingById(db, bookingId);
    if (!ref) return "none";
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        uid: true,
        status: true,
        userId: true,
        startTime: true, // Flowko U30: race check
        endTime: true,
        responses: true,
        attendees: { select: { name: true }, orderBy: { id: "asc" }, take: 1 },
        flowkoBookingSteps: {
          select: { index: true, kind: true, startTime: true, endTime: true, serviceName: true },
          orderBy: { index: "asc" },
        },
      },
    });
    if (!booking || booking.userId === null || booking.flowkoBookingSteps.length === 0) return "none";
    const accepted = booking.status === BookingStatus.ACCEPTED;
    // An appointment that has ended keeps the events it has (the sync neither writes nor removes them).
    if (accepted && booking.endTime.getTime() <= now.getTime()) return "none";
    const target = await (deps.target ?? googleTargetFor)(db, booking.userId);
    if (!target) return "none";

    const steps = booking.flowkoBookingSteps;
    if (!accepted) {
      const errors = await runAll(
        allStepEventIds(booking.uid, steps).map((id) => ({
          label: "google step event not removed",
          run: () => deleteEvent(target, id),
        })),
        bookingId
      );
      return errors.length > 0 ? "failed" : "synced";
    }

    const business = await db.flowkoBusiness.findUnique({
      where: { id: ref.businessId },
      select: { name: true, timeZone: true },
    });
    if (!business) return "none";
    const responses = booking.responses;
    const formName =
      typeof responses === "object" && responses !== null && !Array.isArray(responses)
        ? (responses as Record<string, unknown>).name
        : undefined;
    const events = stepEventsFor({
      uid: booking.uid,
      businessName: business.name,
      timeZone: business.timeZone,
      customerName:
        typeof formName === "string" && formName.trim() !== ""
          ? formName
          : (booking.attendees[0]?.name ?? ""),
      steps,
      deskUrl: `${WEBAPP_URL}/koledar`,
    });
    const errors = await runAll(
      events.map((event) => ({
        label: "google step event not written",
        run: () => putEvent(target, event),
      })),
      bookingId
    );
    // Flowko U30: a change that landed while the events were being put: once more with the current state.
    if (attempt === 0) {
      const after = await db.booking.findUnique({
        where: { id: bookingId },
        select: { status: true, startTime: true },
      });
      if (
        after &&
        (after.status !== BookingStatus.ACCEPTED || after.startTime.getTime() !== booking.startTime.getTime())
      ) {
        return syncBookingStepEvents(db, bookingId, now, deps, 1);
      }
    }
    return errors.length > 0 ? "failed" : "synced";
  } catch (error) {
    log.error("google step sync failed", { bookingId, ...loggable(error) });
    return "failed";
  }
}

/**
 * R8: deletes the step events of the user's ACCEPTED salon bookings that have not ended (what a lock must do
 * before the user's Google connection is removed). No such booking, or no Google target: "none". "unreachable":
 * Google refuses the connection for good (grant revoked or expired, no access to the calendar), so the events
 * cannot be deleted and the caller removes the connection anyway. "failed": the lookup or any delete failed
 * otherwise (the caller then keeps the connection). Never throws.
 */
export async function removeStepEventsOfUser(
  db: FlowkoDb,
  userId: number,
  now: Date,
  deps: TargetDeps = {}
): Promise<"none" | "removed" | "unreachable" | "failed"> {
  try {
    const { eventTypeIds } = await mirrorIdsOfUser(db, userId);
    if (eventTypeIds.length === 0) return "none";
    const bookings = await db.booking.findMany({
      where: {
        userId,
        eventTypeId: { in: eventTypeIds },
        status: BookingStatus.ACCEPTED,
        endTime: { gt: now },
      },
      select: { uid: true, flowkoBookingSteps: { select: { index: true }, orderBy: { index: "asc" } } },
    });
    const ids = bookings.flatMap((b) => allStepEventIds(b.uid, b.flowkoBookingSteps));
    if (ids.length === 0) return "none";
    let target: StepCalendar | null;
    try {
      target = await (deps.target ?? googleTargetFor)(db, userId);
    } catch (error) {
      // The target could not be built: a connection that is invalid by now is unreachable, any other cause fails.
      const valid = await db.credential.count({
        where: { userId, type: GOOGLE_CALENDAR, OR: [{ invalid: false }, { invalid: null }] },
      });
      if (valid === 0) {
        log.warn("google step events unreachable", loggable(error));
        return "unreachable";
      }
      throw error;
    }
    if (!target) return "none";
    const errors = await runAll(
      ids.map((id) => ({ label: "google step event not removed", run: () => deleteEvent(target, id) }))
    );
    if (errors.length === 0) return "removed";
    if (errors.every(isRefusedForGood)) {
      log.warn("google step events unreachable", loggable(errors[0]));
      return "unreachable";
    }
    return "failed";
  } catch (error) {
    log.error("google step removal failed", loggable(error));
    return "failed";
  }
}
