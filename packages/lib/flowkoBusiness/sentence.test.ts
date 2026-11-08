// Flowko U27: a sentence that ends with an interpolated name must not end with "..".
import { describe, expect, it } from "vitest";

import { dropDoubledFullStop } from "./sentence";

describe("dropDoubledFullStop", () => {
  it("drops the sentence's own full stop when the interpolated value already ends with one", () => {
    expect(
      dropDoubledFullStop(
        "Za prestavitev termina se obrnite na ponudnika storitve: Frizerstvo Maja s.p..",
        "Frizerstvo Maja s.p."
      )
    ).toBe("Za prestavitev termina se obrnite na ponudnika storitve: Frizerstvo Maja s.p.");
    expect(
      dropDoubledFullStop("To reschedule, please contact the service provider: Salon d.o.o..", "Salon d.o.o.")
    ).toBe("To reschedule, please contact the service provider: Salon d.o.o.");
  });

  it("leaves a sentence alone when the value does not end with a full stop", () => {
    expect(dropDoubledFullStop("Contact: Salon Lepota.", "Salon Lepota")).toBe("Contact: Salon Lepota.");
    expect(dropDoubledFullStop("Contact: Salon & Co.", "Salon & Co")).toBe("Contact: Salon & Co.");
  });

  it("only touches a sentence that really ends with the value and a full stop", () => {
    expect(dropDoubledFullStop("Salon s.p. is closed", "Salon s.p.")).toBe("Salon s.p. is closed");
    expect(dropDoubledFullStop("Contact: Salon s.p.", "Salon s.p.")).toBe("Contact: Salon s.p.");
    expect(dropDoubledFullStop("", "")).toBe("");
  });
});
