// Flowko U25: isSmsCalEmail also covers the never-deliverable desk-only placeholder (@flowko.invalid).
import { describe, expect, it } from "vitest";

import isSmsCalEmail from "./isSmsCalEmail";

describe("isSmsCalEmail", () => {
  it("is true for Cal's phone-number faux address", () => {
    expect(isSmsCalEmail("123@sms.cal.com")).toBe(true);
  });

  it("is true for a desk-only placeholder, in any case", () => {
    expect(isSmsCalEmail("desk-x@flowko.invalid")).toBe(true);
    expect(isSmsCalEmail("DESK-X@FLOWKO.INVALID")).toBe(true);
  });

  it("is false for real addresses and look-alike domains", () => {
    expect(isSmsCalEmail("ana@flowko.si")).toBe(false);
    expect(isSmsCalEmail("x@invalid.flowko.si")).toBe(false);
    expect(isSmsCalEmail("x@notflowko.invalid")).toBe(false);
  });
});
