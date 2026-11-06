import { describe, expect, it } from "vitest";
import { dueReminders, getResponsesEmail, pickBooker, REMINDER_LOOKBACK_MINUTES } from "./attendeeReminders";

// Flowko U22: when a booking's reminder is due (R3) and who gets it (R4). Run with TZ=UTC.
const MIN = 60_000;
const START = new Date("2026-11-20T10:00:00.000Z");
const at = (minutesFromStart: number) => new Date(START.getTime() + minutesFromStart * MIN);
const LONG_AGO = new Date("2026-11-01T08:00:00.000Z");

const booking = (
  metadata: unknown,
  overrides: Partial<{ createdAt: Date; updatedAt: Date | null }> = {}
) => ({
  startTime: START,
  createdAt: LONG_AGO,
  updatedAt: null as Date | null,
  eventTypeMetadata: metadata,
  ...overrides,
});

const both = { flowkoReminders: { enabled: true, offsets: [1440, 120] } };
const dayOnly = { flowkoReminders: { enabled: true, offsets: [1440] } };

describe("dueReminders", () => {
  it("uses a 60-minute lookback", () => {
    expect(REMINDER_LOOKBACK_MINUTES).toBe(60);
  });

  it("is empty when the setting is absent, off or invalid", () => {
    const now = at(-1440);
    expect(dueReminders(booking(null), now)).toEqual([]);
    expect(dueReminders(booking(undefined), now)).toEqual([]);
    expect(dueReminders(booking("not an object"), now)).toEqual([]);
    expect(dueReminders(booking([1440]), now)).toEqual([]);
    expect(dueReminders(booking({}), now)).toEqual([]);
    expect(dueReminders(booking({ flowkoReminders: { enabled: false, offsets: [1440, 120] } }), now)).toEqual(
      []
    );
    expect(dueReminders(booking({ flowkoReminders: { enabled: true, offsets: [60] } }), now)).toEqual([]);
    expect(dueReminders(booking({ flowkoReminders: { enabled: true, offsets: [] } }), now)).toEqual([]);
    expect(dueReminders(booking({ flowkoReminders: { enabled: "yes", offsets: [1440] } }), now)).toEqual([]);
  });

  it("ignores the rest of the metadata, even when it is invalid", () => {
    expect(dueReminders(booking({ ...dayOnly, bookerLayouts: "garbage" }), at(-1440))).toEqual([1440]);
  });

  it("24 h reminder is due from T−24h up to T−24h+59min, not a minute before or at +60min", () => {
    expect(dueReminders(booking(dayOnly), at(-1440))).toEqual([1440]);
    expect(dueReminders(booking(dayOnly), at(-1440 + 59))).toEqual([1440]);
    expect(dueReminders(booking(dayOnly), at(-1440 - 1))).toEqual([]);
    expect(dueReminders(booking(dayOnly), at(-1440 + 60))).toEqual([]);
  });

  it("treats the two offsets independently", () => {
    expect(dueReminders(booking(both), at(-1440 + 5))).toEqual([1440]);
    expect(dueReminders(booking(both), at(-120 + 5))).toEqual([120]);
    expect(dueReminders(booking(both), at(-600))).toEqual([]);
    expect(dueReminders(booking({ flowkoReminders: { enabled: true, offsets: [120] } }), at(-1440))).toEqual(
      []
    );
    expect(dueReminders(booking({ flowkoReminders: { enabled: true, offsets: [120] } }), at(-120))).toEqual([
      120,
    ]);
  });

  it("a booking created after its reminder moment gets no reminder", () => {
    const now = at(-1440 + 10);
    expect(dueReminders(booking(dayOnly, { createdAt: at(-1440 + 1) }), now)).toEqual([]);
    expect(dueReminders(booking(dayOnly, { createdAt: at(-1440) }), now)).toEqual([1440]);
  });

  it("a booking updated (e.g. confirmed) after its reminder moment gets no reminder", () => {
    const now = at(-120 + 10);
    expect(dueReminders(booking(both, { updatedAt: at(-120 + 1) }), now)).toEqual([]);
    expect(dueReminders(booking(both, { updatedAt: at(-120) }), now)).toEqual([120]);
    expect(dueReminders(booking(both, { updatedAt: at(-3000) }), now)).toEqual([120]);
  });

  it("takes the lookback as a parameter", () => {
    expect(dueReminders(booking(dayOnly), at(-1440 + 30), 30)).toEqual([]);
    expect(dueReminders(booking(dayOnly), at(-1440 + 29), 30)).toEqual([1440]);
  });
});

describe("pickBooker", () => {
  const attendees = [
    { id: 7, email: "guest@example.com", name: "Guest" },
    { id: 3, email: "first@example.com", name: "First" },
    { id: 9, email: "Booker@Example.com", name: "Booker" },
  ];

  it("prefers the attendee whose e-mail is responses.email, case-insensitive", () => {
    expect(pickBooker(attendees, "booker@EXAMPLE.com")?.id).toBe(9);
  });

  it("falls back to the lowest id when responses.email is absent or matches nobody", () => {
    expect(pickBooker(attendees)?.id).toBe(3);
    expect(pickBooker(attendees, "nobody@example.com")?.id).toBe(3);
  });

  it("is undefined without attendees", () => {
    expect(pickBooker([], "a@b.c")).toBeUndefined();
  });
});

describe("getResponsesEmail", () => {
  it("reads a string responses.email, else undefined", () => {
    expect(getResponsesEmail({ email: "a@b.c", name: "A" })).toBe("a@b.c");
    expect(getResponsesEmail({ email: 5 })).toBeUndefined();
    expect(getResponsesEmail(null)).toBeUndefined();
    expect(getResponsesEmail("a@b.c")).toBeUndefined();
  });
});
