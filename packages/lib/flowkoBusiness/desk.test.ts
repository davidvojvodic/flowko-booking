// Flowko U28: tests for the client-safe desk helpers. Run under TZ=UTC; the zone is explicit.
import { describe, expect, it } from "vitest";

import { dayBounds, localInterval, wallClockToMs } from "@calcom/lib/flowkoSalon";
import type { FitProblem, Interval } from "@calcom/lib/flowkoSalon";

import {
  columnBands,
  escapeLikeValue,
  formatHm,
  freeEdgesFor,
  hourRange,
  laneLayout,
  phoneDigitsForSearch,
  problemKey,
  rangeSpans,
  stepSegments,
  tapToStart,
  toPx,
} from "./desk";

const TZ = "Europe/Ljubljana";
const at = (date: string, time: string) => wallClockToMs(date, time, TZ);
const iv = (date: string, from: string, to: string): Interval => localInterval(date, from, to, TZ);
const HOUR = 3_600_000;
const MIN = 60_000;

describe("hourRange", () => {
  const D = "2026-11-16";
  it("floors and ceils the union to whole local hours", () => {
    const r = hourRange(dayBounds(D, TZ), TZ, [iv(D, "07:00", "20:00"), iv(D, "06:30", "07:30")]);
    expect(r.from).toBe(at(D, "06:00"));
    expect(r.to).toBe(at(D, "20:00"));
    expect(r.hours[0]).toEqual({ at: at(D, "06:00"), label: "06:00" });
    expect(r.hours).toHaveLength(14);
    expect(r.hours[13].label).toBe("19:00");
  });

  it("ceils a span that ends inside an hour", () => {
    const r = hourRange(dayBounds(D, TZ), TZ, [iv(D, "08:10", "16:20")]);
    expect(r.from).toBe(at(D, "08:00"));
    expect(r.to).toBe(at(D, "17:00"));
  });

  it("falls back to 08-18 without spans", () => {
    const r = hourRange(dayBounds(D, TZ), TZ, []);
    expect(r.from).toBe(at(D, "08:00"));
    expect(r.to).toBe(at(D, "18:00"));
    expect(r.hours.map((h) => h.label)).toEqual([
      "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
    ]);
  });

  it("clips spans to the day and ignores spans outside it", () => {
    const r = hourRange(dayBounds(D, TZ), TZ, [
      { start: at(D, "00:00") - 5 * HOUR, end: at(D, "01:30") },
      iv("2026-11-17", "10:00", "12:00"),
    ]);
    expect(r.from).toBe(at(D, "00:00"));
    expect(r.to).toBe(at(D, "02:00"));
  });

  it("skips 02:00 on the 23 h spring day", () => {
    const day = dayBounds("2027-03-28", TZ);
    expect(day.end - day.start).toBe(23 * HOUR);
    const r = hourRange(day, TZ, [day]);
    expect(r.from).toBe(day.start);
    expect(r.to).toBe(day.end);
    expect(r.hours).toHaveLength(23);
    const labels = r.hours.map((h) => h.label);
    expect(labels).not.toContain("02:00");
    expect(labels.slice(0, 4)).toEqual(["00:00", "01:00", "03:00", "04:00"]);
  });

  it("shows 02:00 twice on the 25 h autumn day", () => {
    const day = dayBounds("2026-10-25", TZ);
    expect(day.end - day.start).toBe(25 * HOUR);
    const r = hourRange(day, TZ, [day]);
    expect(r.hours).toHaveLength(25);
    expect(r.hours.filter((h) => h.label === "02:00")).toHaveLength(2);
    expect(r.to - r.from).toBe(25 * HOUR);
  });
});

describe("rangeSpans", () => {
  const D = "2026-11-16";
  it("collects opening, shifts, time off and bookings, never other busy", () => {
    const view = {
      opening: [iv(D, "07:00", "20:00")],
      columns: [
        {
          shifts: [iv(D, "08:00", "12:00")],
          timeOff: [iv(D, "14:00", "15:00")],
          otherBusy: [iv(D, "00:00", "24:00")], // Google block, must be ignored
        },
      ],
      bookings: [iv(D, "09:00", "10:00")],
    };
    const spans = rangeSpans(view);
    expect(spans).toHaveLength(4);
    const r = hourRange(dayBounds(D, TZ), TZ, spans);
    expect(r.from).toBe(at(D, "07:00"));
    expect(r.to).toBe(at(D, "20:00"));
  });
});

describe("toPx", () => {
  it("is minutes from the range start times pxPerMinute", () => {
    const from = at("2026-11-16", "08:00");
    expect(toPx(from + 90 * MIN, { from }, 1.5)).toBe(135);
    expect(toPx(from, { from }, 2)).toBe(0);
  });
});

describe("tapToStart", () => {
  const D = "2026-11-16";
  const day = dayBounds(D, TZ);
  it("floors to the grid without edges", () => {
    expect(tapToStart(at(D, "09:37"), day, 15, [])).toBe(at(D, "09:30"));
    expect(tapToStart(at(D, "09:37"), day, 5, [])).toBe(at(D, "09:35"));
  });
  it("picks the free-interval start just under a colouring", () => {
    const busy = [iv(D, "09:00", "10:40")];
    const edges = freeEdgesFor({ shifts: [iv(D, "08:00", "17:00")], timeOff: [], busy });
    expect(tapToStart(at(D, "10:42"), day, 15, edges)).toBe(at(D, "10:40"));
    expect(tapToStart(at(D, "10:52"), day, 15, edges)).toBe(at(D, "10:45"));
  });
  it("ignores an edge at or before the grid start and one after the tap", () => {
    expect(tapToStart(at(D, "10:30"), day, 15, [at(D, "10:30")])).toBe(at(D, "10:30"));
    expect(tapToStart(at(D, "10:35"), day, 15, [at(D, "10:40")])).toBe(at(D, "10:30"));
  });
  it("takes the latest of several edges", () => {
    expect(tapToStart(at(D, "10:44"), day, 15, [at(D, "10:32"), at(D, "10:41")])).toBe(at(D, "10:41"));
  });
});

describe("freeEdgesFor", () => {
  const D = "2026-11-16";
  it("returns the starts of the worker's free intervals", () => {
    const edges = freeEdgesFor({
      shifts: [iv(D, "08:00", "12:00"), iv(D, "13:00", "17:00")],
      timeOff: [iv(D, "14:00", "15:00")],
      busy: [iv(D, "09:00", "10:40")],
    });
    expect(edges).toEqual([at(D, "08:00"), at(D, "10:40"), at(D, "13:00"), at(D, "15:00")]);
  });
});

describe("laneLayout", () => {
  const D = "2026-11-16";
  it("puts two overlapping busy blocks side by side", () => {
    const m = laneLayout([
      { id: 1, busy: [iv(D, "09:00", "10:00")] },
      { id: 2, busy: [iv(D, "09:30", "10:30")] },
    ]);
    expect(m.get(1)).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(2)).toEqual({ lane: 1, lanes: 2 });
  });
  it("keeps a booking inside a processing gap at full width", () => {
    const m = laneLayout([
      { id: 1, busy: [iv(D, "09:00", "09:30"), iv(D, "10:30", "11:00")] }, // gap 09:30-10:30
      { id: 2, busy: [iv(D, "09:45", "10:15")] },
    ]);
    expect(m.get(1)).toEqual({ lane: 0, lanes: 1 });
    expect(m.get(2)).toEqual({ lane: 0, lanes: 1 });
  });
  it("sizes lanes per connected group and reuses a free lane", () => {
    const m = laneLayout([
      { id: 1, busy: [iv(D, "09:00", "10:00")] },
      { id: 2, busy: [iv(D, "09:30", "11:00")] },
      { id: 3, busy: [iv(D, "10:00", "10:30")] }, // touches 1 only at the edge, overlaps 2
      { id: 4, busy: [iv(D, "14:00", "15:00")] },
    ]);
    expect(m.get(1)).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(2)).toEqual({ lane: 1, lanes: 2 });
    expect(m.get(3)).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(4)).toEqual({ lane: 0, lanes: 1 });
  });
  it("treats touching blocks as not overlapping and handles three at once", () => {
    const m = laneLayout([
      { id: 1, busy: [iv(D, "09:00", "10:00")] },
      { id: 2, busy: [iv(D, "10:00", "11:00")] },
      { id: 3, busy: [iv(D, "09:00", "11:00")] },
    ]);
    expect(m.get(1)).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(2)).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(3)).toEqual({ lane: 1, lanes: 2 });
  });
  it("gives a block without busy time lane 0 of 1", () => {
    expect(laneLayout([{ id: 9, busy: [] }]).get(9)).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("columnBands", () => {
  const D = "2026-11-16";
  it("orders closed / off_shift / shift / time_off exactly", () => {
    const day = dayBounds(D, TZ);
    const bands = columnBands({
      day,
      opening: [iv(D, "07:00", "20:00")],
      shifts: [iv(D, "08:00", "12:00"), iv(D, "13:00", "17:00")],
      timeOff: [iv(D, "14:00", "15:00")],
    });
    expect(bands).toEqual([
      { kind: "closed", start: day.start, end: at(D, "07:00") },
      { kind: "off_shift", start: at(D, "07:00"), end: at(D, "08:00") },
      { kind: "shift", start: at(D, "08:00"), end: at(D, "12:00") },
      { kind: "off_shift", start: at(D, "12:00"), end: at(D, "13:00") },
      { kind: "shift", start: at(D, "13:00"), end: at(D, "14:00") },
      { kind: "time_off", start: at(D, "14:00"), end: at(D, "15:00") },
      { kind: "shift", start: at(D, "15:00"), end: at(D, "17:00") },
      { kind: "off_shift", start: at(D, "17:00"), end: at(D, "20:00") },
      { kind: "closed", start: at(D, "20:00"), end: day.end },
    ]);
  });
  it("is one closed band on a closed day and covers the day without gaps", () => {
    const day = dayBounds(D, TZ);
    expect(columnBands({ day, opening: [], shifts: [iv(D, "08:00", "12:00")], timeOff: [] })).toEqual([
      { kind: "closed", start: day.start, end: day.end },
    ]);
  });
  it("clips to the day on a DST day", () => {
    const d = "2027-03-28";
    const day = dayBounds(d, TZ);
    const bands = columnBands({ day, opening: [iv(d, "07:00", "20:00")], shifts: [iv(d, "08:00", "16:00")], timeOff: [] });
    expect(bands[0].start).toBe(day.start);
    expect(bands[bands.length - 1].end).toBe(day.end);
    for (let i = 1; i < bands.length; i++) expect(bands[i].start).toBe(bands[i - 1].end);
  });
});

describe("stepSegments", () => {
  const D = "2026-11-16";
  it("returns the steps as they are", () => {
    const steps = [
      { kind: "busy" as const, start: at(D, "09:00"), end: at(D, "09:30"), serviceName: "Barvanje" },
      { kind: "processing" as const, start: at(D, "09:30"), end: at(D, "10:10"), serviceName: "Barvanje" },
    ];
    expect(stepSegments({ start: at(D, "09:00"), end: at(D, "10:10"), steps })).toEqual(steps);
  });
  it("draws an untrusted copy (null) as one solid busy segment", () => {
    expect(stepSegments({ start: at(D, "09:00"), end: at(D, "10:10"), steps: null })).toEqual([
      { kind: "busy", start: at(D, "09:00"), end: at(D, "10:10"), serviceName: "" },
    ]);
  });
});

describe("formatHm", () => {
  it("is business wall time in 24 h, whatever the process zone", () => {
    expect(formatHm(Date.parse("2026-11-16T07:07:00Z"), TZ)).toBe("08:07");
    expect(formatHm(Date.parse("2026-07-16T13:30:00Z"), TZ)).toBe("15:30");
    expect(formatHm(Date.parse("2026-11-16T23:05:00Z"), TZ)).toBe("00:05");
  });
});

describe("problemKey", () => {
  it("prefixes the kind", () => {
    const kinds: FitProblem[] = [
      { kind: "outside_opening" },
      { kind: "off_grid" },
      { kind: "too_soon" },
      { kind: "outside_shift", step: 0 },
      { kind: "time_off", step: 0, with: { start: 0, end: 1 } },
      { kind: "overlaps_booking", step: 0, with: { start: 0, end: 1 } },
      { kind: "overlaps_external", step: 0, with: { start: 0, end: 1 } },
    ];
    expect(kinds.map(problemKey)).toEqual([
      "flowko_desk_problem_outside_opening",
      "flowko_desk_problem_off_grid",
      "flowko_desk_problem_too_soon",
      "flowko_desk_problem_outside_shift",
      "flowko_desk_problem_time_off",
      "flowko_desk_problem_overlaps_booking",
      "flowko_desk_problem_overlaps_external",
    ]);
  });
});

describe("phoneDigitsForSearch", () => {
  it.each([
    ["+386 41 123", "38641123"],
    ["041 123", "41123"],
    ["041123456", "41123456"],
    ["(041) 123-456", "41123456"],
    ["04", null],
    ["123", "123"],
    ["12", null],
    ["Ana", null],
    ["Ana 041 123", null],
    ["", null],
  ])("%s -> %s", (q, expected) => {
    expect(phoneDigitsForSearch(q)).toBe(expected);
  });
});

// Flowko U29e: E10.5, R21 (the customer search is literal: % _ and \ are escaped before a LIKE).
describe("escapeLikeValue", () => {
  it.each([
    ["a_b", "a\\_b"],
    ["50%", "50\\%"],
    ["a\\b", "a\\\\b"],
    ["\\%_", "\\\\\\%\\_"],
    ["Marija Novak", "Marija Novak"],
    ["čuk", "čuk"],
    ["", ""],
  ])("%s -> %s", (q, expected) => {
    expect(escapeLikeValue(q)).toBe(expected);
  });
});
