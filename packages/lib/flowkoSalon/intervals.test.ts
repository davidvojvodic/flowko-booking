// Flowko U24: tests for the salon engine's interval arithmetic. Run with TZ=UTC.
import { describe, expect, it } from "vitest";

import { contains, intersect, normalize, overlapping, subtract, union } from "./intervals";

const MIN = 60_000;
const iv = (a: number, b: number) => ({ start: a * MIN, end: b * MIN });

describe("Flowko U24: intervals", () => {
  it("normalize drops empty, sorts, merges overlapping and touching", () => {
    expect(normalize([iv(30, 40), iv(0, 10), iv(10, 20), iv(5, 5)])).toEqual([iv(0, 20), iv(30, 40)]);
  });

  it("normalize drops negative intervals and does not mutate input", () => {
    const input = [iv(30, 40), iv(20, 10), iv(0, 10)];
    const snapshot = JSON.parse(JSON.stringify(input));
    expect(normalize(input)).toEqual([iv(0, 10), iv(30, 40)]);
    expect(input).toEqual(snapshot);
  });

  it("union merges several lists", () => {
    expect(union([iv(0, 10)], [iv(10, 20)], [iv(40, 50)])).toEqual([iv(0, 20), iv(40, 50)]);
    expect(union()).toEqual([]);
  });

  it("intersect", () => {
    expect(intersect([iv(0, 60)], [iv(10, 20), iv(50, 90)])).toEqual([iv(10, 20), iv(50, 60)]);
    expect(intersect([iv(0, 10)], [iv(10, 20)])).toEqual([]);
    expect(intersect([], [iv(0, 10)])).toEqual([]);
  });

  it("subtract", () => {
    expect(subtract([iv(0, 60)], [iv(10, 20), iv(15, 30), iv(55, 70)])).toEqual([iv(0, 10), iv(30, 55)]);
    expect(subtract([iv(0, 10)], [])).toEqual([iv(0, 10)]);
    expect(subtract([], [iv(0, 10)])).toEqual([]);
    expect(subtract([iv(10, 20)], [iv(0, 30)])).toEqual([]);
  });

  it("contains requires one merged interval to hold inner", () => {
    expect(contains([iv(0, 30), iv(30, 60)], iv(20, 40))).toBe(true);
    expect(contains([iv(0, 30), iv(31, 60)], iv(20, 40))).toBe(false);
  });

  it("overlapping is half-open and keeps input order", () => {
    expect(overlapping([iv(0, 10), iv(10, 20)], iv(10, 15))).toEqual([iv(10, 20)]);
    expect(overlapping([iv(30, 40), iv(0, 10), iv(35, 36)], iv(5, 38))).toEqual([iv(30, 40), iv(0, 10), iv(35, 36)]);
  });
});
