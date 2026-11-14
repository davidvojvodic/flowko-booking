// Flowko U28: tests for the client-safe desk helpers. Run under TZ=UTC; the zone is explicit.
import { describe, expect, it } from "vitest";

import { dayBounds, localInterval, wallClockToMs } from "@calcom/lib/flowkoSalon";
import type { FitProblem, Interval } from "@calcom/lib/flowkoSalon";

import {
  bookingTones,
  columnBands,
  deskLaneLayout,
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

// Flowko U29e: E6, R11 — cancelled blocks beside live ones; lane 0 is never a cancelled block.
describe("deskLaneLayout", () => {
  const D = "2026-11-16";
  it("a cancelled-only group keeps lane 0 empty: the cancelled block is lane 1 of 2", () => {
    const m = deskLaneLayout([], [{ id: 7, busy: [iv(D, "10:00", "11:00")] }]);
    expect(m.get(7)).toEqual({ lane: 1, lanes: 2 });
  });
  it("live and cancelled overlapping: live lane 0, cancelled lane 1", () => {
    const m = deskLaneLayout(
      [{ id: 8, busy: [iv(D, "10:00", "11:00")] }],
      [{ id: 7, busy: [iv(D, "10:00", "11:00")] }]
    );
    expect(m.get(8)).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(7)).toEqual({ lane: 1, lanes: 2 });
  });
  it("live first even when the cancelled one starts earlier or has the lower id", () => {
    const m = deskLaneLayout(
      [{ id: 9, busy: [iv(D, "10:30", "11:30")] }],
      [{ id: 1, busy: [iv(D, "10:00", "11:00")] }]
    );
    expect(m.get(9)).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(1)).toEqual({ lane: 1, lanes: 2 });
  });
  it("two cancels and one live in one slot: three lanes, live 0", () => {
    const m = deskLaneLayout(
      [{ id: 3, busy: [iv(D, "10:00", "11:00")] }],
      [
        { id: 1, busy: [iv(D, "10:00", "11:00")] },
        { id: 2, busy: [iv(D, "10:00", "11:00")] },
      ]
    );
    expect(m.get(3)).toEqual({ lane: 0, lanes: 3 });
    expect(m.get(1)).toEqual({ lane: 1, lanes: 3 });
    expect(m.get(2)).toEqual({ lane: 2, lanes: 3 });
  });
  it("two overlapping live blocks keep lanes 0 and 1; a cancelled one beside them takes lane 2", () => {
    const m = deskLaneLayout(
      [
        { id: 1, busy: [iv(D, "09:00", "10:00")] },
        { id: 2, busy: [iv(D, "09:30", "10:30")] },
      ],
      [{ id: 3, busy: [iv(D, "09:00", "10:30")] }]
    );
    expect(m.get(1)).toEqual({ lane: 0, lanes: 3 });
    expect(m.get(2)).toEqual({ lane: 1, lanes: 3 });
    expect(m.get(3)).toEqual({ lane: 2, lanes: 3 });
  });
  it("a cancelled block never takes lane 0, also where no live block overlaps it", () => {
    // live 09:00-10:00; cancelled A 09:30-11:00 overlaps it; cancelled B 10:30-11:30 overlaps only A.
    const m = deskLaneLayout(
      [{ id: 1, busy: [iv(D, "09:00", "10:00")] }],
      [
        { id: 2, busy: [iv(D, "09:30", "11:00")] },
        { id: 3, busy: [iv(D, "10:30", "11:30")] },
      ]
    );
    expect(m.get(1)).toEqual({ lane: 0, lanes: 3 });
    expect(m.get(2)?.lane).toBeGreaterThan(0);
    expect(m.get(3)?.lane).toBeGreaterThan(0);
    expect(m.get(2)?.lane).not.toBe(m.get(3)?.lane);
  });
  it("a live booking with no overlap keeps full width; groups are sized apart", () => {
    const m = deskLaneLayout(
      [
        { id: 1, busy: [iv(D, "09:00", "10:00")] },
        { id: 2, busy: [iv(D, "13:00", "14:00")] },
      ],
      [{ id: 3, busy: [iv(D, "13:00", "14:00")] }]
    );
    expect(m.get(1)).toEqual({ lane: 0, lanes: 1 });
    expect(m.get(2)).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(3)).toEqual({ lane: 1, lanes: 2 });
  });
  it("touching is not overlapping: a cancelled block right after a live one keeps lane 0 empty only for itself", () => {
    const m = deskLaneLayout(
      [{ id: 1, busy: [iv(D, "09:00", "10:00")] }],
      [{ id: 2, busy: [iv(D, "10:00", "11:00")] }]
    );
    expect(m.get(1)).toEqual({ lane: 0, lanes: 1 });
    expect(m.get(2)).toEqual({ lane: 1, lanes: 2 });
  });
  it("without cancelled blocks it is laneLayout", () => {
    const live = [
      { id: 1, busy: [iv(D, "09:00", "10:00")] },
      { id: 2, busy: [iv(D, "09:30", "11:00")] },
      { id: 3, busy: [iv(D, "10:00", "10:30")] },
      { id: 4, busy: [iv(D, "14:00", "15:00")] },
    ];
    expect(deskLaneLayout(live, [])).toEqual(laneLayout(live));
  });
});

// Flowko U29f: F2, R8 as amended (Q1 touch rule as a two-colouring) — a column's live bookings form touch-components
// (busy steps touch or overlap), ordered by earliest (start, id); each is 2-coloured by BFS from its earliest booking,
// neighbours in (start, id) order; the first component starts at a, each later one at the opposite of the latest
// (start, id) booking of all earlier components.
describe("bookingTones", () => {
  const D = "2026-12-01";
  const tones = (m: Map<number, string>, ids: number[]) => ids.map((id) => m.get(id));
  const b = (id: number, ...steps: Array<[string, string]>) => ({
    id,
    start: at(D, steps[0][0]),
    busy: steps.map(([from, to]) => iv(D, from, to)),
  });
  it("an empty column gives an empty map", () => {
    expect(bookingTones([]).size).toBe(0);
  });
  it("one booking is a", () => {
    const m = bookingTones([b(5, ["09:00", "09:30"])]);
    expect(m.size).toBe(1);
    expect(m.get(5)).toBe("a");
  });
  it("three sequential bookings that touch nothing alternate a, b, a", () => {
    const m = bookingTones([b(1, ["09:00", "09:30"]), b(2, ["11:00", "11:30"]), b(3, ["14:00", "14:30"])]);
    expect(tones(m, [1, 2, 3])).toEqual(["a", "b", "a"]);
  });
  it("three touching bookings (09:00-09:30, 09:30-10:00, 10:00-10:30) alternate a, b, a", () => {
    const m = bookingTones([b(1, ["09:00", "09:30"]), b(2, ["09:30", "10:00"]), b(3, ["10:00", "10:30"])]);
    expect(tones(m, [1, 2, 3])).toEqual(["a", "b", "a"]);
  });
  it("input order does not matter: a shuffled column gives the same map", () => {
    const sorted = [
      b(1, ["09:00", "09:30"]),
      b(2, ["09:30", "10:00"]),
      b(3, ["10:00", "10:30"]),
      b(4, ["12:00", "12:30"]),
    ];
    const shuffled = [sorted[2], sorted[0], sorted[3], sorted[1]];
    expect(bookingTones(shuffled)).toEqual(bookingTones(sorted));
    expect(tones(bookingTones(shuffled), [1, 2, 3, 4])).toEqual(["a", "b", "a", "b"]);
  });
  it("equal starts are ordered by id: the lower id is a", () => {
    const m = bookingTones([b(9, ["10:00", "10:30"]), b(4, ["10:00", "10:30"])]);
    expect(m.get(4)).toBe("a");
    expect(m.get(9)).toBe("b");
  });
  it("two overlapping bookings (side-by-side lanes) are a, b", () => {
    const m = bookingTones([b(1, ["09:00", "10:00"]), b(2, ["09:30", "10:30"])]);
    expect(tones(m, [1, 2])).toEqual(["a", "b"]);
  });
  it("Tue 1 Dec Mojca (Maja 09:00 stepped, Ana 09:30 in the gap, Eva 14:00) reads a, b, a", () => {
    const m = bookingTones([
      b(101, ["09:00", "09:30"], ["10:10", "10:40"]), // Maja
      b(102, ["09:30", "10:00"]), // Ana: in Maja's waiting gap, touches her first step
      b(104, ["14:00", "14:30"]), // Eva (Nina's cancelled booking is not passed in)
    ]);
    expect(tones(m, [101, 102, 104])).toEqual(["a", "b", "a"]);
  });
  it("stepped service: a third booking at 10:40 touches Maja's second step and is b, not flush a under a", () => {
    const m = bookingTones([
      b(101, ["09:00", "09:30"], ["10:10", "10:40"]), // Maja
      b(102, ["09:30", "10:00"]), // Ana
      b(103, ["10:40", "11:10"]),
    ]);
    expect(tones(m, [101, 102, 103])).toEqual(["a", "b", "b"]);
  });
  it("lane case: A 09:00-10:00, B 09:30-10:30 (lane 1), C 10:00-11:00 reads a, b, b (an odd ring: BFS reaches B and C from A)", () => {
    const m = bookingTones([b(1, ["09:00", "10:00"]), b(2, ["09:30", "10:30"]), b(3, ["10:00", "11:00"])]);
    expect(tones(m, [1, 2, 3])).toEqual(["a", "b", "b"]);
  });
  it("two touched bookings with equal starts: BFS starts at the lower id, so both others oppose it", () => {
    const m = bookingTones([b(2, ["09:00", "10:00"]), b(1, ["09:00", "10:00"]), b(3, ["10:00", "10:30"])]);
    expect(tones(m, [1, 2, 3])).toEqual(["a", "b", "b"]);
  });
  it("a booking without busy steps touches nothing: its own component, opposite of the latest earlier booking", () => {
    const m = bookingTones([b(1, ["09:00", "09:30"]), { id: 2, start: at(D, "09:30"), busy: [] }]);
    expect(tones(m, [1, 2])).toEqual(["a", "b"]);
  });

  // Flowko U29f: final-review fix wave (SPEC-1, UI-4, TEST-1..3) — R8 as amended, the component two-colouring.
  const touchingSameTone = (live: Array<ReturnType<typeof b>>, m: Map<number, string>) =>
    live.flatMap((x, i) =>
      live
        .slice(i + 1)
        .filter(
          (y) =>
            m.get(x.id) === m.get(y.id) &&
            x.busy.some((s) => y.busy.some((t) => s.start <= t.end && t.start <= s.end))
        )
        .map((y) => [x.id, y.id])
    );
  it("gap fillers under a colouring (E, M stepped, Q, X: a tree of touches) read a, b, b, a: no flush same-tone pair", () => {
    const live = [
      b(1, ["08:30", "09:00"]), // E, touches M's first step
      b(2, ["09:00", "09:30"], ["10:10", "10:40"]), // M, Barvanje
      b(3, ["09:35", "09:50"]), // Q, touches only X
      b(4, ["09:50", "10:10"]), // X, touches Q and M's second step
    ];
    const m = bookingTones(live);
    expect(tones(m, [1, 2, 3, 4])).toEqual(["a", "b", "b", "a"]);
    expect(touchingSameTone(live, m)).toEqual([]);
  });
  it("the same gap fillers without E (M, Q, X) read a, a, b: Q is reached from X, not M", () => {
    const live = [
      b(2, ["09:00", "09:30"], ["10:10", "10:40"]),
      b(3, ["09:35", "09:50"]),
      b(4, ["09:50", "10:10"]),
    ];
    const m = bookingTones(live);
    expect(tones(m, [2, 3, 4])).toEqual(["a", "a", "b"]);
    expect(touchingSameTone(live, m)).toEqual([]);
  });
  it("bridge tree (M stepped, W, V in the gap, T2, B under M's second step) reads a, b, a, a, b with no same-tone touch", () => {
    const live = [
      b(1, ["09:00", "09:30"], ["10:10", "10:40"]), // M
      b(2, ["09:30", "09:40"]), // W, touches M
      b(3, ["09:40", "09:50"]), // V, touches W
      b(4, ["09:55", "10:05"]), // T2, touches B only
      b(5, ["10:05", "10:35"]), // B, touches T2 and overlaps M's second step
    ];
    const m = bookingTones(live);
    expect(tones(m, [1, 2, 3, 4, 5])).toEqual(["a", "b", "a", "a", "b"]);
    expect(touchingSameTone(live, m)).toEqual([]);
  });
  it("known limit 2, odd ring: E, M stepped, G, C (M-G-C a triangle) read a, b, a, a: exactly one same-tone touching pair", () => {
    const live = [
      b(1, ["08:30", "09:00"]), // E
      b(2, ["09:00", "09:30"], ["10:10", "10:40"]), // M
      b(3, ["09:30", "09:50"]), // G, touches M's first step
      b(4, ["09:50", "10:10"]), // C, touches G and M's second step
    ];
    const m = bookingTones(live);
    expect(tones(m, [1, 2, 3, 4])).toEqual(["a", "b", "a", "a"]);
    expect(touchingSameTone(live, m)).toEqual([[3, 4]]);
  });
  it("known limit 2, odd ring without E: M, G, C read a, b, b (BFS gives both of M's neighbours the opposite tone)", () => {
    const live = [
      b(2, ["09:00", "09:30"], ["10:10", "10:40"]),
      b(3, ["09:30", "09:50"]),
      b(4, ["09:50", "10:10"]),
    ];
    const m = bookingTones(live);
    expect(tones(m, [2, 3, 4])).toEqual(["a", "b", "b"]);
    expect(touchingSameTone(live, m)).toEqual([[3, 4]]);
  });
  it("waiting gaps never count: busy steps give a, b, a (the colouring's whole span would tie 09:50 to it: a, b, b)", () => {
    const m = bookingTones([
      b(101, ["09:00", "09:30"], ["10:10", "10:40"]), // Barvanje
      b(108, ["09:30", "09:40"]), // touches the first step
      b(109, ["09:50", "10:00"]), // inside the waiting gap, touches nothing
    ]);
    expect(tones(m, [101, 108, 109])).toEqual(["a", "b", "a"]);
  });
  it("a later component opposes the latest (start, id) booking of the earlier ones (equal starts: the higher id)", () => {
    const m = bookingTones([b(1, ["09:00", "09:30"]), b(2, ["09:00", "10:00"]), b(3, ["11:00", "11:30"])]);
    expect(tones(m, [1, 2, 3])).toEqual(["a", "b", "a"]);
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
