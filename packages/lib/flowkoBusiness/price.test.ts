// Flowko U29e: the price of a service (E8, plan R15). An own formatter (never Intl: ICU differs between Node and
// browsers): „25,00 €“ with a no-break space before „€“, „.“ groups thousands, always two decimals, the same in en
// and sl. The parser works on digit strings only (never parseFloat × 100). The no-break space is built with
// String.fromCharCode, never written as a literal.
import { describe, expect, it } from "vitest";
import { SERVICE_LIMITS } from "./schemas";
import { formatPriceCents, parsePriceText, priceTextOf, priceTotal, storedPriceCents } from "./price";

const NBSP = String.fromCharCode(0xa0);
const euro = (text: string) => `${text}${NBSP}€`;

describe("formatPriceCents", () => {
  it.each([
    [0, "0,00"],
    [5, "0,05"],
    [99, "0,99"],
    [2500, "25,00"],
    [2550, "25,50"],
    [100_000, "1.000,00"],
    [125_000, "1.250,00"],
    [999_999, "9.999,99"],
    [123_456_789, "1.234.567,89"],
  ])("%i cents → the exact text with a no-break space before €", (cents, text) => {
    expect(formatPriceCents(cents)).toBe(euro(text));
  });

  it("has no plain space and exactly one no-break space", () => {
    const text = formatPriceCents(2500);
    expect(text.includes(" ")).toBe(false);
    expect(text.split(NBSP)).toHaveLength(2);
  });

  it("answers an empty text for a value that is not a price (negative, fraction, NaN, Infinity)", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatPriceCents(bad), String(bad)).toBe("");
    }
  });
});

describe("priceTextOf", () => {
  it("is the editor's text: no grouping, no sign, two decimals; null → empty", () => {
    expect(priceTextOf(2550)).toBe("25,50");
    expect(priceTextOf(0)).toBe("0,00");
    expect(priceTextOf(7)).toBe("0,07");
    expect(priceTextOf(125_000)).toBe("1250,00");
    expect(priceTextOf(null)).toBe("");
  });

  it("its text parses back to the same cents", () => {
    for (const cents of [0, 7, 2550, 125_000, 999_999]) {
      expect(parsePriceText(priceTextOf(cents))).toEqual({ ok: true, cents });
    }
  });
});

describe("parsePriceText (R15)", () => {
  it.each([
    ["25", 2500],
    ["0", 0],
    ["007", 700],
    ["25,5", 2550],
    ["25,50", 2550],
    ["25,05", 2505],
    ["25.5", 2550],
    ["25.50", 2550],
    ["0,29", 29],
    ["0.29", 29],
    ["1,1", 110],
    ["1.250,00", 125_000],
    ["1.250,5", 125_050],
    ["9.999,99", 999_999],
    ["25 €", 2500],
    ["25€", 2500],
    ["25 EUR", 2500],
    ["25 eur", 2500],
    ["  25,00  ", 2500],
    ["1 250,00", 125_000],
  ])("accepts %j → %i cents", (text, cents) => {
    expect(parsePriceText(text)).toEqual({ ok: true, cents });
  });

  it("accepts a no-break space anywhere a space may stand", () => {
    expect(parsePriceText(`25,00${NBSP}€`)).toEqual({ ok: true, cents: 2500 });
    expect(parsePriceText(`${NBSP}25${NBSP}`)).toEqual({ ok: true, cents: 2500 });
    expect(parsePriceText(formatPriceCents(125_000))).toEqual({ ok: true, cents: 125_000 });
  });

  it("an empty or blank text is no price (null)", () => {
    expect(parsePriceText("")).toEqual({ ok: true, cents: null });
    expect(parsePriceText("   ")).toEqual({ ok: true, cents: null });
    expect(parsePriceText(NBSP)).toEqual({ ok: true, cents: null });
  });

  it.each([
    ["1.250"],
    ["12.500"],
    ["25,505"],
    ["25.505"],
    [",50"],
    [".50"],
    ["25,"],
    ["25."],
    ["-5"],
    ["+5"],
    ["abc"],
    ["25a"],
    ["2,5,0"],
    ["1,250.00"],
    ["1.25.0"],
    ["€"],
    ["EUR"],
    ["€25"],
    ["25 € €"],
    ["1e3"],
    ["0x10"],
    ["Infinity"],
    ["NaN"],
  ])("refuses %j as price_format", (text) => {
    expect(parsePriceText(text)).toEqual({ ok: false, code: "price_format" });
  });

  it("refuses more than the maximum as price_range; the maximum itself passes", () => {
    expect(SERVICE_LIMITS.priceMaxCents).toBe(999_999);
    expect(parsePriceText("9999,99")).toEqual({ ok: true, cents: 999_999 });
    expect(parsePriceText("10000")).toEqual({ ok: false, code: "price_range" });
    expect(parsePriceText("10.000,00")).toEqual({ ok: false, code: "price_range" });
    // A very long number never becomes an unsafe integer: it is out of range.
    expect(parsePriceText("9".repeat(40))).toEqual({ ok: false, code: "price_range" });
  });
});

describe("priceTotal", () => {
  const services = [
    { id: 1, priceCents: 4500 },
    { id: 2, priceCents: 2000 },
    { id: 3, priceCents: null },
    { id: 4, priceCents: 0 },
  ];

  it("all priced: the sum, nothing unpriced", () => {
    expect(priceTotal(services, [1, 2])).toEqual({ cents: 6500, unpriced: 0 });
    expect(priceTotal(services, [1])).toEqual({ cents: 4500, unpriced: 0 });
    // 0,00 € is a price.
    expect(priceTotal(services, [4])).toEqual({ cents: 0, unpriced: 0 });
  });

  it("partly priced: the sum of the priced ones and the count without a price", () => {
    expect(priceTotal(services, [1, 3])).toEqual({ cents: 4500, unpriced: 1 });
    expect(priceTotal(services, [3, 4])).toEqual({ cents: 0, unpriced: 1 });
  });

  it("none priced or nothing chosen: cents null", () => {
    expect(priceTotal(services, [3])).toEqual({ cents: null, unpriced: 1 });
    expect(priceTotal(services, [])).toEqual({ cents: null, unpriced: 0 });
  });

  it("an unknown id is ignored (neither priced nor unpriced)", () => {
    expect(priceTotal(services, [1, 99])).toEqual({ cents: 4500, unpriced: 0 });
    expect(priceTotal(services, [99])).toEqual({ cents: null, unpriced: 0 });
  });
});

describe("storedPriceCents (the read guard; no CHECK in the database)", () => {
  it("keeps an integer 0..max", () => {
    expect(storedPriceCents(0)).toBe(0);
    expect(storedPriceCents(2500)).toBe(2500);
    expect(storedPriceCents(999_999)).toBe(999_999);
  });

  it("reads anything else as null", () => {
    for (const bad of [null, undefined, -5, -1, 1_000_000, 10_000_000, 1.5, Number.NaN, "2500", {}]) {
      expect(storedPriceCents(bad), String(bad)).toBeNull();
    }
  });
});
