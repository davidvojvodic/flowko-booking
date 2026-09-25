import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarEventBuilder } from "./builder";

// short-uuid's flickrBase58 alphabet, padded to 22 characters
const SHORT_UUID_FORMAT = /^[1-9a-km-zA-HJ-NP-Z]{22}$/;

function buildUid() {
  const builder = new CalendarEventBuilder();
  builder.init({ startTime: "2026-10-01T09:00:00Z" } as Parameters<CalendarEventBuilder["init"]>[0]);
  builder.users = [{ id: 101, username: "organizer" } as CalendarEventBuilder["users"][number]];
  builder.buildUIDCalendarEvent();
  return builder.calendarEvent.uid;
}

describe("CalendarEventBuilder.buildUIDCalendarEvent", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives two events of the same organizer, start and millisecond different random uids", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T10:00:00.000Z"));

    const first = buildUid();
    const second = buildUid();

    expect(first).toMatch(SHORT_UUID_FORMAT);
    expect(second).toMatch(SHORT_UUID_FORMAT);
    expect(first).not.toEqual(second);
  });

  it("still requires buildUsers first", () => {
    const builder = new CalendarEventBuilder();
    expect(() => builder.buildUIDCalendarEvent()).toThrow("call buildUsers before calling this function");
  });
});
