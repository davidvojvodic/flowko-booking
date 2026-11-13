// Flowko U25: business profile rules (opening hours per weekday, service steps, brand colours, profile).
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { describe, expect, it } from "vitest";
import {
  brandColorSchema,
  businessProfileSchema,
  // Flowko U29a: the settings and service editor schemas.
  businessSettingsSchema,
  DEFAULT_REMINDER_OFFSETS,
  // Flowko U29d: the invitee's e-mail and the placeholder-domain rule it shares with the business e-mail.
  inviteEmailSchema,
  isPlaceholderDomain,
  type OpeningHours,
  openingHoursSchema,
  openingIntervalsFor,
  REMINDER_CHOICES,
  SERVICE_LIMITS,
  serviceInputSchema,
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

// Flowko U29a: the owner's settings form (S1, S2, S5) and the service editor (S8, S9).
describe("businessSettingsSchema", () => {
  const flowkoTest = {
    name: "Flowko Test",
    phone: "+386 40 123 456",
    address: "Testna ulica 1, Ljubljana",
    email: "salon@example.si",
    openingHours: template.openingHours,
    slotGridMinutes: 15,
    holidaysClosed: true,
    reminderOffsets: [1440],
    sharedDevice: false,
  };

  function codes(patch: Record<string, unknown>): string[] {
    return issueMessages(businessSettingsSchema.safeParse({ ...flowkoTest, ...patch }));
  }

  it("accepts the Flowko Test values", () => {
    expect(businessSettingsSchema.parse(flowkoTest)).toEqual(flowkoTest);
  });

  it("accepts no address and no e-mail (null)", () => {
    const parsed = businessSettingsSchema.parse({ ...flowkoTest, address: null, email: null });
    expect(parsed.address).toBeNull();
    expect(parsed.email).toBeNull();
  });

  it("trims and lowercases the e-mail", () => {
    expect(businessSettingsSchema.parse({ ...flowkoTest, email: "  Salon@Example.SI " }).email).toBe(
      "salon@example.si"
    );
  });

  // Flowko U29b: only the domain decides; a real domain that merely contains "invalid" stays valid.
  it("accepts a real domain that only starts with invalid", () => {
    expect(businessSettingsSchema.parse({ ...flowkoTest, email: "ana@invalid-salon.si" }).email).toBe(
      "ana@invalid-salon.si"
    );
  });

  it.each([[[]], [[1440]], [[120]], [[1440, 120]]])("accepts the reminder choice %j", (offsets) => {
    expect(businessSettingsSchema.parse({ ...flowkoTest, reminderOffsets: offsets }).reminderOffsets).toEqual(
      offsets
    );
  });

  it("offers exactly the four U22 reminder choices, 24 hours first", () => {
    expect(REMINDER_CHOICES.map((choice) => choice.offsets)).toEqual([[], [1440], [120], [1440, 120]]);
    expect(DEFAULT_REMINDER_OFFSETS).toEqual([1440]);
  });

  it.each([
    ["a desk placeholder e-mail", { email: "x@flowko.invalid" }, "email_placeholder"],
    ["a desk placeholder e-mail in capitals", { email: "X@FLOWKO.INVALID" }, "email_placeholder"],
    ["a phone placeholder e-mail", { email: "0401234@sms.cal.com" }, "email_placeholder"],
    // Flowko U29b: every .invalid and sms.cal.com subdomain is a placeholder too (D1 f).
    ["a flowko.invalid subdomain e-mail", { email: "x@salon.flowko.invalid" }, "email_placeholder"],
    ["any .invalid e-mail", { email: "x@foo.invalid" }, "email_placeholder"],
    ["an sms.cal.com subdomain e-mail", { email: "0401234@a.sms.cal.com" }, "email_placeholder"],
    ["a subdomain placeholder in capitals", { email: "X@SUB.FLOWKO.INVALID" }, "email_placeholder"],
    ["a 255-character e-mail", { email: `${"a".repeat(64)}@${"b".repeat(187)}.si` }, "email_length"],
    ["an e-mail without @", { email: "salon.example.si" }, "email_format"],
    ["reminder offsets [60]", { reminderOffsets: [60] }, "reminder_offsets"],
    ["reminder offsets [1440, 1440]", { reminderOffsets: [1440, 1440] }, "reminder_offsets"],
    [
      "reminder offsets [120, 1440] (not the canonical order)",
      { reminderOffsets: [120, 1440] },
      "reminder_offsets",
    ],
    ["a name with a line break", { name: "Flowko\nTest" }, "control_character"],
    ["a name with a NUL", { name: "Flowko\u0000Test" }, "control_character"],
    ["an empty name", { name: "  " }, "name_length"],
    ["an address with a carriage return", { address: "Testna ulica 1\r, Ljubljana" }, "control_character"],
    ["an address with DEL", { address: "Testna ulica 1\u007f" }, "control_character"],
    ["a missing phone (null)", { phone: null }, "phone_required"],
    ["a missing phone (undefined)", { phone: undefined }, "phone_required"],
    ["an empty phone", { phone: "   " }, "phone_required"],
    ["a phone with letters", { phone: "041 abc 123" }, "phone_format"],
    ["slot grid 25", { slotGridMinutes: 25 }, "slot_grid"],
    [
      "a week with no open day",
      { openingHours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } },
      "no_open_day",
    ],
    ["bad opening hours", { openingHours: withMonday([{ from: "01:00", to: "12:00" }]) }, "before_03_00"],
  ])("refuses %s with its code", (_label, patch, code) => {
    expect(codes(patch)).toContain(code);
  });

  it("checks the e-mail length on the trimmed address (254 characters pass)", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(186)}.si`;
    expect(email).toHaveLength(254);
    expect(codes({ email: ` ${email} ` })).not.toContain("email_length");
  });

  it("refuses a missing switch or holiday flag", () => {
    expect(businessSettingsSchema.safeParse({ ...flowkoTest, sharedDevice: undefined }).success).toBe(false);
    expect(businessSettingsSchema.safeParse({ ...flowkoTest, holidaysClosed: "yes" }).success).toBe(false);
  });

  it("reports codes, never the submitted values", () => {
    const messages = codes({ email: "x@flowko.invalid", name: "Flowko\nTest", address: "Ulica\r1" });
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(m).not.toContain("flowko.invalid");
      expect(m).not.toContain("Flowko");
      expect(m).not.toContain("Ulica");
    }
  });
});

describe("serviceInputSchema", () => {
  const barvanje = {
    name: "Barvanje",
    category: "Barvanje",
    steps: [
      { kind: "busy", minutes: 30 },
      { kind: "processing", minutes: 40 },
      { kind: "busy", minutes: 30 },
    ],
    workerMemberIds: [1, 2],
  };

  function codes(patch: Record<string, unknown>): string[] {
    return issueMessages(serviceInputSchema.safeParse({ ...barvanje, ...patch }));
  }

  function busySteps(count: number, minutes: number): { kind: "busy"; minutes: number }[] {
    return Array.from({ length: count }, () => ({ kind: "busy" as const, minutes }));
  }

  it("accepts Barvanje (30 busy, 40 processing, 30 busy)", () => {
    expect(serviceInputSchema.parse(barvanje)).toEqual(barvanje);
  });

  it("accepts an id for an edit, trims the name and turns an empty category into null", () => {
    const parsed = serviceInputSchema.parse({ ...barvanje, id: 7, name: "  Barvanje  ", category: "  " });
    expect(parsed).toMatchObject({ id: 7, name: "Barvanje", category: null });
    expect(serviceInputSchema.parse({ ...barvanje, category: null }).category).toBeNull();
  });

  it("accepts the limits themselves: 8 steps, a 480-minute step, 720 minutes in total", () => {
    expect(serviceInputSchema.safeParse({ ...barvanje, steps: busySteps(8, 90) }).success).toBe(true);
    expect(
      serviceInputSchema.safeParse({
        ...barvanje,
        steps: [
          { kind: "busy", minutes: 480 },
          { kind: "busy", minutes: 240 },
        ],
      }).success
    ).toBe(true);
    expect(serviceInputSchema.safeParse({ ...barvanje, name: "a".repeat(60) }).success).toBe(true);
    expect(serviceInputSchema.safeParse({ ...barvanje, category: "a".repeat(40) }).success).toBe(true);
    expect(serviceInputSchema.safeParse({ ...barvanje, workerMemberIds: [] }).success).toBe(true);
  });

  it("states the limits once", () => {
    expect(SERVICE_LIMITS).toEqual({
      nameMax: 60,
      categoryMax: 40,
      stepsMax: 8,
      stepMinutesMin: 5,
      stepMinutesMax: 480,
      stepMinutesMultiple: 5,
      totalMinutesMax: 720,
    });
  });

  it.each([
    ["9 steps", { steps: busySteps(9, 30) }, "too_many_steps"],
    [
      "a 485-minute step",
      {
        steps: [
          { kind: "busy", minutes: 30 },
          { kind: "busy", minutes: 485 },
        ],
      },
      "step_too_long:1",
    ],
    [
      "725 minutes in total",
      {
        steps: [
          { kind: "busy", minutes: 480 },
          { kind: "busy", minutes: 245 },
        ],
      },
      "total_too_long",
    ],
    [
      "a processing first step",
      {
        steps: [
          { kind: "processing", minutes: 30 },
          { kind: "busy", minutes: 30 },
        ],
      },
      "starts_with_processing",
    ],
    ["a 7-minute step", { steps: [{ kind: "busy", minutes: 7 }] }, "bad_minutes:0"],
    ["no steps", { steps: [] }, "empty"],
    ["a 61-character name", { name: "a".repeat(61) }, "name_length"],
    ["an empty name", { name: "   " }, "name_length"],
    ["a 41-character category", { category: "a".repeat(41) }, "category_length"],
    ["a name with a line break", { name: "Barva\nnje" }, "control_character"],
    ["a category with a tab", { category: "Barva\tnje" }, "control_character"],
    ["a worker id that is not a positive integer", { workerMemberIds: [0] }, "bad_member"],
    ["a worker named twice", { workerMemberIds: [1, 1] }, "bad_member"],
  ])("refuses %s with its code", (_label, patch, code) => {
    expect(codes(patch)).toContain(code);
  });
});

// Flowko U29d: the invitee's e-mail (I3, Global "E-mail rule"): the business e-mail's chain without null.
describe("inviteEmailSchema", () => {
  const messages = (email: unknown) => issueMessages(inviteEmailSchema.safeParse(email));

  it("trims and lower-cases", () => {
    expect(inviteEmailSchema.parse(" Ana@Example.SI ")).toBe("ana@example.si");
    expect(inviteEmailSchema.parse("david.vojvodic+u29d-a@flowko.si")).toBe(
      "david.vojvodic+u29d-a@flowko.si"
    );
  });

  it("accepts 254 characters and refuses 255 (email_length)", () => {
    const at254 = `${"a".repeat(64)}@${"b".repeat(186)}.si`;
    expect(at254).toHaveLength(254);
    expect(inviteEmailSchema.parse(at254)).toBe(at254);
    expect(messages(`${"a".repeat(64)}@${"b".repeat(187)}.si`)).toContain("email_length");
  });

  it.each([
    ["the desk domain", "x@flowko.invalid"],
    ["the desk domain in capitals", "DESK-1@FLOWKO.INVALID"],
    ["any .invalid domain", "a@b.invalid"],
    ["the bare invalid domain", "a@invalid"],
    ["sms.cal.com", "x@sms.cal.com"],
    ["an sms.cal.com subdomain", "x@a.sms.cal.com"],
  ])("refuses %s", (_label, email) => {
    expect(inviteEmailSchema.safeParse(email).success).toBe(false);
  });

  it("names the placeholder refusal email_placeholder", () => {
    expect(messages("x@flowko.invalid")).toContain("email_placeholder");
    expect(messages("x@sms.cal.com")).toContain("email_placeholder");
  });

  it.each([["salon.example.si"], ["ana@"], ["@example.si"], ["ana @example.si"], [""], ["   "]])(
    "refuses the malformed %j",
    (email) => {
      expect(inviteEmailSchema.safeParse(email).success).toBe(false);
    }
  );

  it("refuses null and a non-string (no .nullable())", () => {
    expect(inviteEmailSchema.safeParse(null).success).toBe(false);
    expect(inviteEmailSchema.safeParse(42).success).toBe(false);
  });

  it("the business e-mail keeps its own rules (nullable, same codes)", () => {
    const shape = businessSettingsSchema.shape.email;
    expect(shape.parse(null)).toBeNull();
    expect(shape.parse(" Salon@Example.SI ")).toBe("salon@example.si");
    expect(issueMessages(shape.safeParse("x@flowko.invalid"))).toContain("email_placeholder");
    expect(issueMessages(shape.safeParse("salon.example.si"))).toContain("email_format");
  });
});

describe("isPlaceholderDomain", () => {
  it("only the domain after the last @ decides", () => {
    expect(isPlaceholderDomain("x@flowko.invalid")).toBe(true);
    expect(isPlaceholderDomain("x@INVALID")).toBe(true);
    expect(isPlaceholderDomain("x@sub.sms.cal.com")).toBe(true);
    expect(isPlaceholderDomain("x@invalid-salon.si")).toBe(false);
    expect(isPlaceholderDomain("invalid@example.si")).toBe(false);
    expect(isPlaceholderDomain("x@cal.com")).toBe(false);
  });
});
