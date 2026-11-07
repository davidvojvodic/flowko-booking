// Flowko U25: server-only generator for desk-only placeholder addresses.
import { describe, expect, it } from "vitest";

import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";

import { makeDeskEmail } from "./deskEmail";

describe("makeDeskEmail", () => {
  it("returns desk-<uuid>@flowko.invalid", () => {
    expect(makeDeskEmail()).toMatch(/^desk-[0-9a-f-]{36}@flowko\.invalid$/);
  });

  it("returns a different address every call, and the client helper recognises it", () => {
    const a = makeDeskEmail();
    const b = makeDeskEmail();
    expect(a).not.toBe(b);
    expect(isFlowkoDeskEmail(a)).toBe(true);
  });
});
