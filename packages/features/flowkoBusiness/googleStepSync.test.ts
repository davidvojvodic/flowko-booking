// Flowko U30: the Google step-event sync on prismock. One business with a login worker (Ana, a Google column) and her
// mirror; bookings are inserted directly with their step copies. Google is a fake calendar recording its calls; the
// app store (credentials, Google client) is mocked and only the googleTargetFor tests reach it.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported.
import "@calcom/prisma";
import logger from "@calcom/lib/logger";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLoginMember, createBusiness } from "./business";
import type { FlowkoDb } from "./db";
import { stepEventId } from "./googleStepEvents";
import {
  googleTargetFor,
  removeStepEventsOfUser,
  type StepCalendar,
  syncBookingStepEvents,
} from "./googleStepSync";
import { ensureWorkerMirror } from "./mirror";

const appStore = vi.hoisted(() => ({
  credentials: vi.fn(),
  service: vi.fn(),
}));
vi.mock("@calcom/app-store/delegationCredential", () => ({
  getUsersCredentialsIncludeServiceAccountKey: appStore.credentials,
}));
vi.mock("@calcom/app-store/googlecalendar/lib/CalendarService", () => ({
  createGoogleCalendarServiceWithGoogleType: appStore.service,
}));

const db = prismock as unknown as FlowkoDb;
const NOW = new Date("2026-11-16T07:00:00Z");
const d = (time: string, date = "2026-11-16") => new Date(`${date}T${time}:00Z`);
let seq = 0;

type Step = { kind: "busy" | "processing"; start: Date; end: Date; name: string };
const THREE: Step[] = [
  { kind: "busy", start: d("09:00"), end: d("09:30"), name: "Barvanje" },
  { kind: "processing", start: d("09:30"), end: d("10:00"), name: "Barvanje" },
  { kind: "busy", start: d("10:00"), end: d("10:20"), name: "Barvanje" },
];

type Fixture = { a: number; ana: number; mirrorEventTypeId: number };
let f: Fixture;
let calls: Array<{ op: "insert" | "update" | "delete"; args: Record<string, unknown> }>;
let events: Record<"insert" | "update" | "delete", ReturnType<typeof vi.fn>>;
let target: StepCalendar;
let logError: ReturnType<typeof vi.spyOn>;

async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon Demo",
    slug: `gs-${seq}`,
    templateId: "hair-salon",
  });
  const ana = await makeUser("Ana");
  const member = await addLoginMember(db, created.businessId, ana, FlowkoBusinessRole.WORKER);
  const mirror = await ensureWorkerMirror(db as never, member.memberId);
  return { a: created.businessId, ana, mirrorEventTypeId: mirror.eventTypeId };
}

async function insertBooking(over: {
  status?: BookingStatus;
  start?: Date;
  end?: Date;
  steps?: Step[];
  eventTypeId?: number | null;
  userId?: number;
  name?: string;
}): Promise<{ id: number; uid: string }> {
  seq += 1;
  const steps = over.steps ?? THREE;
  const booking = await prismock.booking.create({
    data: {
      uid: `uidsecret${seq}`,
      title: "Direct",
      startTime: over.start ?? steps[0].start,
      endTime: over.end ?? steps[steps.length - 1].end,
      status: over.status ?? BookingStatus.ACCEPTED,
      userId: over.userId ?? f.ana,
      eventTypeId: over.eventTypeId === undefined ? f.mirrorEventTypeId : over.eventTypeId,
      responses: { name: over.name ?? "Marija Novak", attendeePhoneNumber: "041123456" },
    },
    select: { id: true, uid: true },
  });
  await prismock.attendee.create({
    data: {
      bookingId: booking.id,
      name: "Attendee Name",
      email: "x@example.com",
      timeZone: "Europe/Ljubljana",
    },
  });
  for (let index = 0; index < steps.length; index += 1) {
    await prismock.flowkoBookingStep.create({
      data: {
        bookingId: booking.id,
        index,
        kind: steps[index].kind,
        startTime: steps[index].start,
        endTime: steps[index].end,
        serviceId: null,
        serviceName: steps[index].name,
      },
    });
  }
  return booking;
}

// Flowko U30: the shape of a real gaxios 6 HTTP error: numeric `status` and `response.status`, no `code`.
const gx = (s: number) =>
  Object.assign(new Error(`Request failed with status code ${s}`), { status: s, response: { status: s } });
const ids = (uid: string, indexes: number[]) => indexes.map((i) => stepEventId(uid, i));
const withTarget = (value: StepCalendar | null = target) => ({ target: async () => value });

beforeEach(async () => {
  f = await setUp();
  calls = [];
  events = {
    insert: vi.fn(async (args: Record<string, unknown>) => void calls.push({ op: "insert", args })),
    update: vi.fn(async (args: Record<string, unknown>) => void calls.push({ op: "update", args })),
    delete: vi.fn(async (args: Record<string, unknown>) => void calls.push({ op: "delete", args })),
  };
  target = { calendarId: "calendar-secret@example.com", events: events as unknown as StepCalendar["events"] };
  logError = vi
    .spyOn(Object.getPrototypeOf(logger) as { error: (...args: unknown[]) => unknown }, "error")
    .mockImplementation(() => undefined);
  appStore.credentials.mockReset();
  appStore.service.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncBookingStepEvents", () => {
  it("puts one event per busy step of an ACCEPTED future booking, never one for a processing step", async () => {
    const booking = await insertBooking({});
    await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget())).resolves.toBe("synced");

    expect(calls.map((c) => c.op)).toEqual(["update", "update"]);
    expect(calls.map((c) => c.args.eventId)).toEqual(ids(booking.uid, [0, 2]));
    for (const call of calls) {
      expect(call.args.sendUpdates).toBe("none");
      expect(call.args.calendarId).toBe("calendar-secret@example.com");
      const body = call.args.requestBody as Record<string, unknown>;
      expect(body.status).toBe("confirmed");
      expect(body).not.toHaveProperty("attendees");
      expect(body.id).toBe(call.args.eventId);
      expect(body.summary).toBe("Barvanje – Marija N.");
      expect(JSON.stringify(body)).not.toContain(booking.uid);
      expect(JSON.stringify(body)).not.toContain("041123456");
    }
    expect((calls[0].args.requestBody as { description: string }).description).toContain(
      "Salon Demo\nObisk: Barvanje"
    );
    expect((calls[0].args.requestBody as { description: string }).description).toContain("/koledar");
  });

  it("falls back to the first attendee's name when the form has none", async () => {
    const booking = await insertBooking({});
    await prismock.booking.update({ where: { id: booking.id }, data: { responses: {} } });
    await syncBookingStepEvents(db, booking.id, NOW, withTarget());
    expect((calls[0].args.requestBody as { summary: string }).summary).toBe("Barvanje – Attendee N.");
  });

  it("update 404 -> insert with the step id; insert 409 -> one more update", async () => {
    const booking = await insertBooking({ steps: [THREE[0]] });
    events.update.mockRejectedValueOnce(gx(404));
    await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget())).resolves.toBe("synced");
    expect(calls.map((c) => c.op)).toEqual(["insert"]);
    expect((calls[0].args.requestBody as { id: string }).id).toBe(stepEventId(booking.uid, 0));
    expect(calls[0].args.sendUpdates).toBe("none");

    calls.length = 0;
    events.update.mockClear();
    events.insert.mockClear();
    events.update.mockRejectedValueOnce(gx(404));
    events.insert.mockRejectedValueOnce(gx(409));
    await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget())).resolves.toBe("synced");
    expect(events.update).toHaveBeenCalledTimes(2); // the 404, then the update after the insert's 409
    expect(events.insert).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.op)).toEqual(["update"]);
    expect((calls[0].args.requestBody as { status: string }).status).toBe("confirmed");
  });

  it("a string status code (some client versions) is read as well", async () => {
    const booking = await insertBooking({ steps: [THREE[0]] });
    events.update.mockRejectedValueOnce({ code: "404" });
    await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget())).resolves.toBe("synced");
    expect(calls.map((c) => c.op)).toEqual(["insert"]);
  });

  it("a CANCELLED booking deletes every step id; 404 and 410 count as done", async () => {
    const booking = await insertBooking({ status: BookingStatus.CANCELLED });
    events.delete.mockRejectedValueOnce(gx(410)).mockRejectedValueOnce(gx(404));
    await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget())).resolves.toBe("synced");
    expect(events.delete).toHaveBeenCalledTimes(3);
    expect(events.delete.mock.calls.map((c) => (c[0] as { eventId: string }).eventId)).toEqual(
      ids(booking.uid, [0, 1, 2])
    );
    expect(
      events.delete.mock.calls.every((c) => (c[0] as { sendUpdates: string }).sendUpdates === "none")
    ).toBe(true);
    expect(events.update).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it("an ACCEPTED booking that has ended gets no call", async () => {
    const booking = await insertBooking({});
    await expect(syncBookingStepEvents(db, booking.id, d("10:20"), withTarget())).resolves.toBe("none");
    expect(calls).toEqual([]);
  });

  it("no target, or a plain Cal booking: none and no call", async () => {
    const booking = await insertBooking({});
    await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget(null))).resolves.toBe("none");
    const plain = await insertBooking({ eventTypeId: null });
    await expect(syncBookingStepEvents(db, plain.id, NOW, withTarget())).resolves.toBe("none");
    await expect(syncBookingStepEvents(db, 987654, NOW, withTarget())).resolves.toBe("none");
    expect(calls).toEqual([]);
  });

  it("a failing step does not stop the next one; failed, logged once without customer data", async () => {
    const booking = await insertBooking({});
    events.update.mockRejectedValueOnce(
      Object.assign(gx(500), { message: "Marija Novak calendar-secret@example.com is not allowed" })
    );
    await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget())).resolves.toBe("failed");
    expect(events.update).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(logError.mock.calls[0]);
    expect(logged).toContain("500");
    for (const secret of ["Marija", "Novak", "calendar-secret", "not allowed", booking.uid, "041123456"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("a throwing target answers failed and never rejects", async () => {
    const booking = await insertBooking({});
    const throwing = {
      target: async () => {
        throw Object.assign(new Error("token for marija@example.com revoked"), { code: 401 });
      },
    };
    await expect(syncBookingStepEvents(db, booking.id, NOW, throwing)).resolves.toBe("failed");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("marija@example.com");
  });

  // Flowko U30: two changes to one booking racing: the pass that finishes last re-reads the booking once.
  describe("a change that lands while the sync runs", () => {
    it("the booking is cancelled meanwhile: the second pass deletes every step id", async () => {
      const booking = await insertBooking({});
      events.update.mockImplementationOnce(async (args: Record<string, unknown>) => {
        calls.push({ op: "update", args });
        await prismock.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.CANCELLED },
        });
      });
      await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget())).resolves.toBe("synced");
      expect(calls.map((c) => c.op)).toEqual(["update", "update", "delete", "delete", "delete"]);
      expect(calls.slice(2).map((c) => c.args.eventId)).toEqual(ids(booking.uid, [0, 1, 2]));
    });

    it("the booking is moved meanwhile: the second pass puts the new times", async () => {
      const booking = await insertBooking({ steps: [THREE[0]] });
      const moved = { start: d("14:00"), end: d("14:30") };
      events.update.mockImplementationOnce(async (args: Record<string, unknown>) => {
        calls.push({ op: "update", args });
        await prismock.booking.update({
          where: { id: booking.id },
          data: { startTime: moved.start, endTime: moved.end },
        });
        await prismock.flowkoBookingStep.updateMany({
          where: { bookingId: booking.id },
          data: { startTime: moved.start, endTime: moved.end },
        });
      });
      await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget())).resolves.toBe("synced");
      expect(calls.map((c) => c.op)).toEqual(["update", "update"]);
      expect((calls[0].args.requestBody as { start: { dateTime: string } }).start.dateTime).toBe(
        d("09:00").toISOString()
      );
      expect((calls[1].args.requestBody as { start: { dateTime: string } }).start.dateTime).toBe(
        moved.start.toISOString()
      );
    });

    it("an unchanged booking is synced once; a booking that keeps changing is re-run at most once", async () => {
      const booking = await insertBooking({ steps: [THREE[0]] });
      await syncBookingStepEvents(db, booking.id, NOW, withTarget());
      expect(calls).toHaveLength(1);

      calls.length = 0;
      let minutes = 0;
      events.update.mockImplementation(async (args: Record<string, unknown>) => {
        calls.push({ op: "update", args });
        minutes += 5;
        await prismock.booking.update({
          where: { id: booking.id },
          data: { startTime: new Date(d("09:00").getTime() + minutes * 60_000) },
        });
      });
      await expect(syncBookingStepEvents(db, booking.id, NOW, withTarget())).resolves.toBe("synced");
      expect(calls).toHaveLength(2);
    });
  });
});

describe("removeStepEventsOfUser", () => {
  it("deletes the step ids of the future ACCEPTED bookings only", async () => {
    const future = await insertBooking({});
    const past = await insertBooking({
      steps: [
        { kind: "busy", start: d("07:00", "2026-11-15"), end: d("07:30", "2026-11-15"), name: "Barvanje" },
      ],
    });
    const cancelled = await insertBooking({ status: BookingStatus.CANCELLED });
    await expect(removeStepEventsOfUser(db, f.ana, NOW, withTarget())).resolves.toBe("removed");
    expect(events.delete.mock.calls.map((c) => (c[0] as { eventId: string }).eventId)).toEqual(
      ids(future.uid, [0, 1, 2])
    );
    const all = JSON.stringify(events.delete.mock.calls);
    expect(all).not.toContain(stepEventId(past.uid, 0));
    expect(all).not.toContain(stepEventId(cancelled.uid, 0));
  });

  it("a failing delete answers failed; no target and nothing to delete answer none", async () => {
    await insertBooking({});
    events.delete.mockRejectedValueOnce(gx(500));
    await expect(removeStepEventsOfUser(db, f.ana, NOW, withTarget())).resolves.toBe("failed");
    expect(events.delete).toHaveBeenCalledTimes(3);
    await expect(removeStepEventsOfUser(db, f.ana, NOW, withTarget(null))).resolves.toBe("none");
    await expect(removeStepEventsOfUser(db, f.ana, d("23:00"), withTarget())).resolves.toBe("none");
    const stranger = await makeUser("Zoran");
    await expect(removeStepEventsOfUser(db, stranger, NOW, withTarget())).resolves.toBe("none");
  });

  // Flowko U30: R8 — Google refusing the connection for good must not keep the lock "failed" for ever.
  const storeGoogleCredential = async (invalid: boolean) => {
    seq += 1;
    await prismock.credential.create({
      data: {
        id: 9000 + seq,
        type: "google_calendar",
        key: {},
        userId: f.ana,
        appId: "google-calendar",
        invalid,
      },
    });
  };
  const gx403 = (reason: string) =>
    Object.assign(gx(403), { response: { status: 403, data: { error: { errors: [{ reason }] } } } });

  it("every delete refused with 401: unreachable (the grant is gone); logged by class and code only", async () => {
    await insertBooking({});
    events.delete.mockRejectedValue(gx(401));
    await expect(removeStepEventsOfUser(db, f.ana, NOW, withTarget())).resolves.toBe("unreachable");
    expect(events.delete).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logError.mock.calls)).not.toContain("Request failed");
  });

  it("invalid_grant (400) counts as refused for good", async () => {
    await insertBooking({});
    events.delete.mockRejectedValue(
      Object.assign(gx(400), { response: { status: 400, data: { error: "invalid_grant" } } })
    );
    await expect(removeStepEventsOfUser(db, f.ana, NOW, withTarget())).resolves.toBe("unreachable");
  });

  it("403 for a rate limit: failed (retry later)", async () => {
    await insertBooking({});
    events.delete.mockRejectedValue(gx403("rateLimitExceeded"));
    await expect(removeStepEventsOfUser(db, f.ana, NOW, withTarget())).resolves.toBe("failed");
  });

  it("403 for another reason (no access to the calendar): unreachable", async () => {
    await insertBooking({});
    events.delete.mockRejectedValue(gx403("forbidden"));
    await expect(removeStepEventsOfUser(db, f.ana, NOW, withTarget())).resolves.toBe("unreachable");
  });

  it("one refused delete among other failures: failed", async () => {
    await insertBooking({});
    events.delete.mockRejectedValueOnce(gx(401)).mockRejectedValueOnce(gx(500));
    await expect(removeStepEventsOfUser(db, f.ana, NOW, withTarget())).resolves.toBe("failed");
  });

  it("a throwing target: failed while her stored credential is still valid", async () => {
    await insertBooking({});
    await storeGoogleCredential(false);
    const throwing = {
      target: async () => {
        throw new Error("no token");
      },
    };
    await expect(removeStepEventsOfUser(db, f.ana, NOW, throwing)).resolves.toBe("failed");
  });

  it("a throwing target: unreachable once her stored credential is invalid (or gone)", async () => {
    await insertBooking({});
    const throwing = {
      target: async () => {
        throw new Error("no token");
      },
    };
    await storeGoogleCredential(true);
    await expect(removeStepEventsOfUser(db, f.ana, NOW, throwing)).resolves.toBe("unreachable");
  });
});

describe("googleTargetFor", () => {
  const credentialRow = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    type: "google_calendar",
    invalid: false,
    ...over,
  });
  async function storeCredential(id: number, over: { invalid?: boolean | null; type?: string } = {}) {
    await prismock.credential.create({
      data: {
        id,
        type: over.type ?? "google_calendar",
        key: {},
        userId: f.ana,
        appId: "google-calendar",
        invalid: over.invalid ?? false,
      },
    });
  }
  const serviceFor = (credential: { id: number }) => ({
    authedCalendar: async () => ({ events: { fromCredential: credential.id } }),
  });

  beforeEach(() => {
    appStore.service.mockImplementation(serviceFor);
  });

  it("uses the destination calendar and its credential", async () => {
    await storeCredential(3);
    await storeCredential(7);
    appStore.credentials.mockResolvedValue([credentialRow(3), credentialRow(7)]);
    await prismock.destinationCalendar.create({
      data: {
        integration: "google_calendar",
        externalId: "salon@example.com",
        userId: f.ana,
        credentialId: 7,
      },
    });
    const result = await googleTargetFor(db, f.ana);
    expect(result?.calendarId).toBe("salon@example.com");
    expect(result?.events).toEqual({ fromCredential: 7 });
    expect(appStore.credentials).toHaveBeenCalledWith({ id: f.ana, email: "" });
  });

  it("a destination on another integration: the first Google credential and primary", async () => {
    await storeCredential(3);
    await storeCredential(7);
    appStore.credentials.mockResolvedValue([credentialRow(3), credentialRow(7)]);
    await prismock.destinationCalendar.create({
      data: {
        integration: "office365_calendar",
        externalId: "other@example.com",
        userId: f.ana,
        credentialId: 7,
      },
    });
    const result = await googleTargetFor(db, f.ana);
    expect(result?.calendarId).toBe("primary");
    expect(result?.events).toEqual({ fromCredential: 3 });
  });

  it("a destination on an invalid or foreign credential falls back to the first valid one", async () => {
    await storeCredential(3);
    await storeCredential(7, { invalid: true });
    appStore.credentials.mockResolvedValue([credentialRow(3), credentialRow(7, { invalid: true })]);
    await prismock.destinationCalendar.create({
      data: {
        integration: "google_calendar",
        externalId: "salon@example.com",
        userId: f.ana,
        credentialId: 7,
      },
    });
    const result = await googleTargetFor(db, f.ana);
    expect(result?.calendarId).toBe("primary");
    expect(result?.events).toEqual({ fromCredential: 3 });
  });

  it("only an invalid credential, or none: null before any app-store module is used", async () => {
    await expect(googleTargetFor(db, f.ana)).resolves.toBeNull();
    await storeCredential(7, { invalid: true });
    await storeCredential(8, { type: "google_video" });
    await expect(googleTargetFor(db, f.ana)).resolves.toBeNull();
    expect(appStore.credentials).not.toHaveBeenCalled();
    expect(appStore.service).not.toHaveBeenCalled();
  });

  it("a credential that is valid only in the stored row but invalid in the loaded list gives null", async () => {
    await storeCredential(3);
    appStore.credentials.mockResolvedValue([credentialRow(3, { invalid: true })]);
    await expect(googleTargetFor(db, f.ana)).resolves.toBeNull();
  });
});
