import { describe, expect, it } from "vitest";

import { realTranslator } from "./testUtils/realTranslator";
import { translateServerMessage } from "./translateServerMessage";

describe("translateServerMessage", () => {
  it("says a key in the UI language", () => {
    expect(translateServerMessage(realTranslator("sl").t, "booking_not_found")).toBe(
      "Rezervacije ni mogoče najti"
    );
    expect(translateServerMessage(realTranslator("en").t, "booking_not_found")).toBe("Booking not found");
  });

  it("leaves a sentence alone, because i18next would split it at the dot or colon", () => {
    const { t } = realTranslator("sl");
    expect(translateServerMessage(t, "Rate limit exceeded. Try again in 5 seconds.")).toBe(
      "Rate limit exceeded. Try again in 5 seconds."
    );
    expect(translateServerMessage(t, "Error: x")).toBe("Error: x");
  });

  it("gives nothing for an empty message", () => {
    expect(translateServerMessage(realTranslator("sl").t, undefined)).toBeUndefined();
    expect(translateServerMessage(realTranslator("sl").t, "")).toBeUndefined();
  });
});
