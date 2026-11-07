// Flowko U25: the client-safe desk-address helper must stay import-free (isSmsCalEmail reaches client bundles).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FLOWKO_DESK_EMAIL_DOMAIN, isFlowkoDeskEmail } from "./deskEmail";

describe("flowkoBusiness/deskEmail (client-safe)", () => {
  it("uses the RFC 2606 .invalid domain", () => {
    expect(FLOWKO_DESK_EMAIL_DOMAIN).toBe("flowko.invalid");
  });

  it("matches the domain as a case-insensitive suffix after an @", () => {
    expect(isFlowkoDeskEmail("desk-1@flowko.invalid")).toBe(true);
    expect(isFlowkoDeskEmail("Desk-1@FLOWKO.Invalid")).toBe(true);
    expect(isFlowkoDeskEmail("ana@flowko.si")).toBe(false);
    expect(isFlowkoDeskEmail("x@evil-flowko.invalid")).toBe(false);
    expect(isFlowkoDeskEmail("flowko.invalid")).toBe(false);
  });

  it("has no import, no re-export and no node: reference in its source", () => {
    const source = readFileSync(path.join(__dirname, "deskEmail.ts"), "utf8");
    expect(source).not.toContain("node:");
    expect(source).not.toMatch(/^\s*(import|export .* from)\s/m);
  });
});
