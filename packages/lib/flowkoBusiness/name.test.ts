// Flowko U25: the business slug shape (one name space with usernames; see name.ts).
import { describe, expect, it } from "vitest";
import { FLOWKO_SLUG_PATTERN, isFlowkoSlugShape } from "./name";

describe("isFlowkoSlugShape", () => {
  it.each(["studio", "flowko-test-business", "a1"])("accepts %j", (name) => {
    expect(isFlowkoSlugShape(name)).toBe(true);
  });

  it.each([
    "Studio",
    "ana.bar",
    "ana_bar",
    "-ana",
    "ana-",
    "ana--b",
    "łuka",
    "a",
    "",
    " studio",
  ])("refuses %j", (name) => {
    expect(isFlowkoSlugShape(name)).toBe(false);
  });

  it("accepts 60 characters and refuses 61", () => {
    expect(isFlowkoSlugShape("a".repeat(60))).toBe(true);
    expect(isFlowkoSlugShape("a".repeat(61))).toBe(false);
  });

  it("exports the pattern verbatim", () => {
    expect(FLOWKO_SLUG_PATTERN.source).toBe("^[a-z0-9]+(?:-[a-z0-9]+)*$");
  });
});
