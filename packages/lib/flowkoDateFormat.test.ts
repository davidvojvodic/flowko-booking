import { describe, expect, it } from "vitest";

import { withOrdinalDot } from "./flowkoDateFormat";

describe("U18 withOrdinalDot", () => {
  it("adds the Slovene ordinal dot after the day of the month", () => {
    expect(withOrdinalDot("ddd, D MMM", "sl")).toBe("ddd, D. MMM");
    expect(withOrdinalDot("ddd, D MMM YYYY", "sl")).toBe("ddd, D. MMM YYYY");
    expect(withOrdinalDot("D MMMM YYYY", "sl")).toBe("D. MMMM YYYY");
    expect(withOrdinalDot("D MMMM YYYY", "sl-SI")).toBe("D. MMMM YYYY");
  });

  it("leaves other languages and two-digit days alone", () => {
    expect(withOrdinalDot("ddd, D MMM", "en")).toBe("ddd, D MMM");
    expect(withOrdinalDot("D MMMM YYYY", undefined)).toBe("D MMMM YYYY");
    expect(withOrdinalDot("DD.MM.YYYY", "sl")).toBe("DD.MM.YYYY");
    expect(withOrdinalDot("dddd", "sl")).toBe("dddd");
  });
});
