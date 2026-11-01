import { describe, expect, it } from "vitest";

import en from "./en/common.json";
import sl from "./sl/common.json";

// Flowko U14 Task 4: the cancel wording.

const enKeys = en as Record<string, string>;
const slKeys = sl as Record<string, string>;

describe("cancel wording", () => {
  it("the generic cancel button is Prekliči in Slovene", () => {
    expect(slKeys.cancel).toBe("Prekliči");
    expect(enKeys.cancel).toBe("Cancel");
  });

  it("the booker's cancel link has its own key", () => {
    expect(slKeys.cancel_booking_link).toBe("Odpovej");
    expect(enKeys.cancel_booking_link).toBe("Cancel");
  });

  it("the old hidden embed help line is gone and the link key exists in both languages", () => {
    expect(enKeys.need_help_embedding).toBeUndefined();
    expect(slKeys.need_help_embedding).toBeUndefined();
    expect(enKeys.embed_help_link).toContain("<0>");
    expect(slKeys.embed_help_link).toContain("<0>");
  });
});
