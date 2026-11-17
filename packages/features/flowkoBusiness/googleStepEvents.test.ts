// Flowko U30: the pure builder of a salon booking's Google step events (ids, title, description). No database, no Google.
import { describe, expect, it } from "vitest";
import {
  allStepEventIds,
  type StepCopy,
  shortCustomerName,
  stepEventId,
  stepEventsFor,
} from "./googleStepEvents";

const TZ = "Europe/Ljubljana";
const d = (time: string) => new Date(`2026-11-16T${time}:00+01:00`);

const steps: StepCopy[] = [
  { index: 0, kind: "busy", startTime: d("10:00"), endTime: d("10:30"), serviceName: "Barvanje" },
  { index: 1, kind: "processing", startTime: d("10:30"), endTime: d("11:00"), serviceName: "Barvanje" },
  { index: 2, kind: "busy", startTime: d("11:00"), endTime: d("11:20"), serviceName: "Barvanje" },
  { index: 3, kind: "busy", startTime: d("11:20"), endTime: d("11:50"), serviceName: "Striženje" },
];

describe("stepEventId", () => {
  it("is a stable base32hex id that never contains the uid", () => {
    const id = stepEventId("abc", 0);
    expect(id).toMatch(/^fs[0-9a-v]{64}$/);
    expect(stepEventId("abc", 0)).toBe(id);
    expect(stepEventId("abc", 1)).not.toBe(id);
    expect(stepEventId("abd", 0)).not.toBe(id);
    expect(id).not.toContain("abc");
  });
});

describe("shortCustomerName", () => {
  it.each([
    ["Ana Kovač", "Ana K."],
    ["  Ana   Marija  kovač ", "Ana K."],
    ["Špela čeh", "Špela Č."],
    ["Mojca", "Mojca"],
    ["", "Stranka"],
    ["   ", "Stranka"],
  ])("%j -> %j", (name, short) => {
    expect(shortCustomerName(name)).toBe(short);
  });
});

describe("stepEventsFor", () => {
  const input = {
    uid: "uid-secret-123",
    businessName: "Salon Demo",
    timeZone: TZ,
    customerName: "Ana Kovač",
    deskUrl: "https://x.test/koledar",
  };

  it("builds one event per busy step, in index order", () => {
    const events = stepEventsFor({ ...input, steps });
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.id)).toEqual([0, 2, 3].map((i) => stepEventId(input.uid, i)));
    expect(events[0].summary).toBe("Barvanje – Ana K.");
    expect(events[2].summary).toBe("Striženje – Ana K.");
    expect(events[0].description).toBe(
      "Salon Demo\nObisk: Barvanje + Striženje — 1. del od 3\nTermin uredite v Flowku: https://x.test/koledar"
    );
    expect(events[1].description).toContain("2. del od 3");
    expect(events[0].start).toEqual({ dateTime: d("10:00").toISOString(), timeZone: TZ });
    expect(events[0].end).toEqual({ dateTime: d("10:30").toISOString(), timeZone: TZ });
    for (const e of events) {
      expect(e.visibility).toBe("private");
      expect(e.transparency).toBe("opaque");
      expect(e.reminders).toEqual({ useDefault: true });
      expect(e).not.toHaveProperty("attendees");
      expect(JSON.stringify(e)).not.toContain(input.uid);
    }
  });

  it("a single busy step has no part counter and services are listed once", () => {
    const [event] = stepEventsFor({ ...input, steps: [steps[0], steps[1]] });
    expect(event.description.split("\n")[1]).toBe("Obisk: Barvanje");
    const dup = stepEventsFor({ ...input, steps });
    expect(dup[0].description.split("\n")[1]).toBe("Obisk: Barvanje + Striženje — 1. del od 3");
  });

  it("orders by index even when the input is shuffled", () => {
    const events = stepEventsFor({ ...input, steps: [steps[3], steps[0], steps[2], steps[1]] });
    expect(events.map((e) => e.id)).toEqual([0, 2, 3].map((i) => stepEventId(input.uid, i)));
  });
});

describe("allStepEventIds", () => {
  it("returns one id per step including processing", () => {
    expect(allStepEventIds("u", steps)).toEqual([0, 1, 2, 3].map((i) => stepEventId("u", i)));
  });
});
