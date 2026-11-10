// Flowko U29b (Task 8, S14): the roster writes' error codes and their texts, in both languages (the ServiceSheet pin).
import { describe, expect, it } from "vitest";

import { ROSTER_ERROR_CODES, rosterErrorCode, rosterErrorKey } from "./rosterErrors";
import { localeT } from "./desk.fixture";

const trpcError = (message: string, code = "BAD_REQUEST") =>
  Object.assign(new Error(message), { data: { code } });

describe("rosterErrorCode / rosterErrorKey", () => {
  it("reads the Flowko code from the message, the rate limiter from data.code, anything else is unknown", () => {
    expect(rosterErrorCode(trpcError("roster_conflict"))).toBe("roster_conflict");
    expect(rosterErrorCode(trpcError("roster_changed"))).toBe("roster_changed");
    expect(rosterErrorCode(trpcError("Too many", "TOO_MANY_REQUESTS"))).toBe("TOO_MANY_REQUESTS");
    expect(rosterErrorCode(trpcError("something odd", "INTERNAL_SERVER_ERROR"))).toBe("unknown");
    expect(rosterErrorCode(new Error("network"))).toBe("unknown");
    expect(rosterErrorCode(null)).toBe("unknown");
  });

  it("every server code has its text in sl and en", () => {
    const sl = localeT("sl");
    const en = localeT("en");
    for (const code of ROSTER_ERROR_CODES) {
      const key = rosterErrorKey(code);
      expect(sl(key)).not.toBe(key);
      expect(en(key)).not.toBe(key);
    }
    expect(sl("flowko_roster_error_roster_conflict")).toBe("Hkrati je shranjeval še nekdo. Poskusite znova.");
    expect(sl("flowko_roster_stale")).toBe(
      "Urnik je medtem spremenil nekdo drug. Prikazan je trenutni urnik."
    );
    expect(en("flowko_roster_stale")).not.toBe("flowko_roster_stale");
  });

  it("TOO_MANY_REQUESTS and unknown codes reuse the U29a generic texts", () => {
    expect(rosterErrorKey("TOO_MANY_REQUESTS")).toBe("flowko_settings_error_TOO_MANY_REQUESTS");
    expect(rosterErrorKey("unknown")).toBe("something_went_wrong");
    expect(localeT("sl")("flowko_settings_error_TOO_MANY_REQUESTS")).not.toBe(
      "flowko_settings_error_TOO_MANY_REQUESTS"
    );
  });
});
