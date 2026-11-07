// Flowko U25: business profile rules (opening hours per weekday, service steps, brand colours, profile).
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { describe, expect, it } from "vitest";
import {
  brandColorSchema,
  businessProfileSchema,
  type OpeningHours,
  openingHoursSchema,
  openingIntervalsFor,
  serviceStepsSchema,
} from "./schemas";
import { FLOWKO_TEMPLATES } from "./templates";

const template = FLOWKO_TEMPLATES["hair-salon"];
const tz = "Europe/Ljubljana";
const HOUR_MS = 3_600_000;

function withMonday(mon: { from: string; to: string }[]): unknown {
  return { ...template.openingHours, mon };
}

function issueMessages(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => i.message);
}

describe("openingHoursSchema", () => {
  it("accepts the hair-salon template's hours", () => {
    expect(openingHoursSchema.parse(template.openingHours)).toEqual(template.openingHours);
  });

  it.each([
    ["an empty interval 08:00-08:00", [{ from: "08:00", to: "08:00" }]],
    [
      "overlapping 07-12 and 11-14",
      [
        { from: "07:00", to: "12:00" },
        { from: "11:00", to: "14:00" },
      ],
    ],
    [
      "unsorted intervals",
      [
        { from: "13:00", to: "18:00" },
        { from: "07:00", to: "12:00" },
      ],
    ],
    ["a 01:00 start (before the 03:00 floor)", [{ from: "01:00", to: "12:00" }]],
    ["a single-digit hour 7:00", [{ from: "7:00", to: "12:00" }]],
    ["a 24:00 start", [{ from: "24:00", to: "24:00" }]],
    ["25:00", [{ from: "07:00", to: "25:00" }]],
  ])("rejects %s", (_label, mon) => {
    expect(openingHoursSchema.safeParse(withMonday(mon)).success).toBe(false);
  });

  it("rejects a missing sun key", () => {
    const { sun: _sun, ...noSunday } = template.openingHours;
    expect(openingHoursSchema.safeParse(noSunday).success).toBe(false);
  });

  it("rejects an unknown day key", () => {
    expect(openingHoursSchema.safeParse({ ...template.openingHours, holiday: [] }).success).toBe(false);
  });

  it("accepts 24:00 as an end, touching intervals and the 03:00 floor", () => {
    const hours = withMonday([
      { from: "03:00", to: "12:00" },
      { from: "12:00", to: "24:00" },
    ]);
    expect(openingHoursSchema.safeParse(hours).success).toBe(true);
  });

  it("reports codes, never the submitted values", () => {
    const messages = issueMessages(
      openingHoursSchema.safeParse(withMonday([{ from: "01:00", to: "12:00" }]))
    );
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) expect(m).not.toContain("01:00");
  });
});

describe("brandColorSchema", () => {
  it("expands a 3-digit colour and lowercases it", () => {
    expect(brandColorSchema.parse("#ABC")).toBe("#aabbcc");
  });

  it("lowercases a 6-digit colour", () => {
    expect(brandColorSchema.parse("#1A2B3C")).toBe("#1a2b3c");
  });

  it.each(["red", "#abcd", "abc", "#ggg", ""])("rejects %j", (value) => {
    expect(brandColorSchema.safeParse(value).success).toBe(false);
  });
});

describe("serviceStepsSchema", () => {
  it("accepts busy · processing · busy", () => {
    const steps = [
      { kind: "busy", minutes: 30 },
      { kind: "processing", minutes: 40 },
      { kind: "busy", minutes: 30 },
    ];
    expect(serviceStepsSchema.parse(steps)).toEqual(steps);
  });

  it("rejects a processing-only list with the U24 code in the issue", () => {
    const messages = issueMessages(serviceStepsSchema.safeParse([{ kind: "processing", minutes: 30 }]));
    expect(messages).toContain("no_busy_step");
    expect(messages).toContain("starts_with_processing");
  });

  it("rejects bad minutes and an empty list with the U24 codes", () => {
    expect(issueMessages(serviceStepsSchema.safeParse([{ kind: "busy", minutes: 7 }]))).toContain(
      "bad_minutes:0"
    );
    expect(issueMessages(serviceStepsSchema.safeParse([]))).toContain("empty");
  });

  it("rejects an unknown kind and extra keys", () => {
    expect(serviceStepsSchema.safeParse([{ kind: "pause", minutes: 30 }]).success).toBe(false);
    expect(serviceStepsSchema.safeParse([{ kind: "busy", minutes: 30, price: 5 }]).success).toBe(false);
  });
});

describe("openingIntervalsFor", () => {
  it("gives 13 hours on the autumn DST Sunday 2026-10-25 when Sunday is open 07-20", () => {
    const hours: OpeningHours = { ...template.openingHours, sun: [{ from: "07:00", to: "20:00" }] };
    const start = wallClockToMs("2026-10-25", "07:00", tz);
    expect(openingIntervalsFor(hours, "2026-10-25", tz)).toEqual([{ start, end: start + 13 * HOUR_MS }]);
  });

  it("gives no interval on a closed Sunday (the template, 2026-10-25)", () => {
    expect(openingIntervalsFor(template.openingHours, "2026-10-25", tz)).toEqual([]);
  });

  it("gives 13 hours on Monday 2026-10-26", () => {
    const intervals = openingIntervalsFor(template.openingHours, "2026-10-26", tz);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].start).toBe(wallClockToMs("2026-10-26", "07:00", tz));
    expect(intervals[0].end - intervals[0].start).toBe(13 * HOUR_MS);
  });

  it("gives Saturday 07-13 and one interval per entry in order", () => {
    const hours: OpeningHours = {
      ...template.openingHours,
      sat: [
        { from: "07:00", to: "10:00" },
        { from: "11:00", to: "13:00" },
      ],
    };
    const intervals = openingIntervalsFor(hours, "2026-10-31", tz);
    expect(intervals).toEqual([
      { start: wallClockToMs("2026-10-31", "07:00", tz), end: wallClockToMs("2026-10-31", "10:00", tz) },
      { start: wallClockToMs("2026-10-31", "11:00", tz), end: wallClockToMs("2026-10-31", "13:00", tz) },
    ]);
  });

  it("throws on a malformed date even on a closed day", () => {
    expect(() => openingIntervalsFor(template.openingHours, "2026-13-01", tz)).toThrow(RangeError);
  });
});

describe("businessProfileSchema", () => {
  const valid = {
    name: "  Frizerski salon Ana  ",
    slug: "salon-ana",
    phone: "+386 41 123 456",
    address: "Glavna ulica 1, Ljubljana",
    websiteUrl: "https://salon-ana.si",
    instagramHandle: "salon.ana_lj",
    brandColor: "#ABC",
    darkBrandColor: null,
    openingHours: template.openingHours,
    slotGridMinutes: 15,
    showPrices: false,
    selfCancelHours: 24,
    timeZone: tz,
  };

  it("accepts a full profile, trims the name and normalises the colour", () => {
    const parsed = businessProfileSchema.parse(valid);
    expect(parsed.name).toBe("Frizerski salon Ana");
    expect(parsed.brandColor).toBe("#aabbcc");
    expect(parsed.darkBrandColor).toBeNull();
  });

  it("accepts nulls for the optional contact fields and colours", () => {
    const parsed = businessProfileSchema.parse({
      ...valid,
      phone: null,
      address: null,
      websiteUrl: null,
      instagramHandle: null,
      brandColor: null,
    });
    expect(parsed.phone).toBeNull();
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["an 81-character name", { name: "a".repeat(81) }],
    ["an uppercase slug", { slug: "Salon-Ana" }],
    ["a phone with letters", { phone: "041 abc 123" }],
    ["a too-short phone", { phone: "12345" }],
    ["a 201-character address", { address: "a".repeat(201) }],
    ["an http website", { websiteUrl: "http://salon-ana.si" }],
    ["a website that is not a URL", { websiteUrl: "salon-ana" }],
    ["an Instagram handle with @", { instagramHandle: "@salon" }],
    ["a bad brand colour", { brandColor: "red" }],
    ["a bad dark brand colour", { darkBrandColor: "#12" }],
    ["slot grid 25", { slotGridMinutes: 25 }],
    ["self-cancel 169 hours", { selfCancelHours: 169 }],
    ["self-cancel -1 hours", { selfCancelHours: -1 }],
    ["an unknown time zone", { timeZone: "Europe/Atlantis" }],
    ["an offset as time zone", { timeZone: "+01:00" }],
    ["bad opening hours", { openingHours: withMonday([{ from: "01:00", to: "12:00" }]) }],
  ])("rejects %s", (_label, patch) => {
    expect(businessProfileSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
