import { eventTypeMetaDataSchemaWithTypedApps } from "@calcom/app-store/zod-utils";
import { describe, expect, it } from "vitest";
import z from "zod";
import {
  EventTypeMetaDataSchema,
  excludeOrRequireEmailSchema,
  FLOWKO_REMINDER_OFFSETS,
  flowkoRemindersSchema,
} from "./zod-utils";

describe("excludeOrRequireEmailSchema", () => {
  const parse = (input: string) => z.object({ v: excludeOrRequireEmailSchema }).safeParse({ v: input });

  describe("valid inputs", () => {
    it("accepts single TLD domains", () => {
      expect(parse("gmail.com").success).toBe(true);
    });

    it("accepts uppercase domains", () => {
      expect(parse("GMAIL.COM").success).toBe(true);
    });

    it("accepts multi-level TLD domains (co.uk)", () => {
      expect(parse("hotmail.co.uk").success).toBe(true);
    });

    it("accepts multi-level TLD domains (k12.us)", () => {
      expect(parse("mail.school.k12.us").success).toBe(true);
    });

    it("accepts full email addresses", () => {
      expect(parse("user@example.co.uk").success).toBe(true);
    });

    it("accepts @domain format", () => {
      expect(parse("@example.co.uk").success).toBe(true);
    });

    it("accepts multiple comma-separated entries", () => {
      expect(parse("gmail.com, @example.com, user@example.co.uk").success).toBe(true);
    });

    it("accepts domains with trailing comma (ignores empty entry)", () => {
      expect(parse("gmail.com, hotmail.co.uk,").success).toBe(true);
    });

    it("accepts domains with extra spaces", () => {
      expect(parse("  gmail.com  ,  hotmail.co.uk  ").success).toBe(true);
    });

    it("accepts domains with numbers and hyphens", () => {
      expect(parse("example123.com").success).toBe(true);
      expect(parse("my-domain.com").success).toBe(true);
    });

    it("accepts very short domains (min 2-char TLD)", () => {
      expect(parse("a.co").success).toBe(true);
    });

    it("accepts long multi-level domains", () => {
      expect(parse("example.co.uk.test.com").success).toBe(true);
    });

    it("accepts single-label domains and missing dots", () => {
      expect(parse("example").success).toBe(true);
      expect(parse("@example").success).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects invalid TLD lengths", () => {
      expect(parse("example.c").success).toBe(false);
    });

    it("rejects leading/trailing hyphens in labels", () => {
      expect(parse("-bad.com").success).toBe(false);
      expect(parse("bad-.com").success).toBe(false);
    });

    it("rejects leading/trailing dots and consecutive dots", () => {
      expect(parse(".bad.com").success).toBe(false);
      expect(parse("bad.com.").success).toBe(false);
      expect(parse("ex..ample.com").success).toBe(false);
    });

    it("allows empty input but rejects commas-only", () => {
      expect(parse("").success).toBe(true);
      expect(parse("   ").success).toBe(true);
      expect(parse(",,,").success).toBe(false);
    });

    it("rejects Unicode domains (ASCII-only)", () => {
      expect(parse("münchen.de").success).toBe(false);
    });
  });
});

// Flowko U22: the per-service reminder setting has to survive the metadata schemas (they strip unknown keys).
describe("Flowko U22: flowkoReminders in event-type metadata", () => {
  const reminders = { enabled: true, offsets: [1440, 120] };

  it("keeps flowkoReminders through EventTypeMetaDataSchema, with the other keys", () => {
    const parsed = EventTypeMetaDataSchema.parse({
      bookerLayouts: null,
      disableSuccessPage: true,
      flowkoReminders: reminders,
    });
    expect(parsed).toEqual({ bookerLayouts: null, disableSuccessPage: true, flowkoReminders: reminders });
  });

  it("keeps flowkoReminders through eventTypeMetaDataSchemaWithTypedApps", () => {
    const parsed = eventTypeMetaDataSchemaWithTypedApps.parse({
      apps: {},
      flowkoReminders: { enabled: false, offsets: [120] },
    });
    expect(parsed?.flowkoReminders).toEqual({ enabled: false, offsets: [120] });
  });

  it("leaves an absent flowkoReminders absent", () => {
    const parsed = EventTypeMetaDataSchema.parse({ disableSuccessPage: true });
    expect(parsed).toEqual({ disableSuccessPage: true });
    expect(parsed && "flowkoReminders" in parsed).toBe(false);
  });

  it.each([[[60]], [[]], [[1440, 1440]]])("rejects offsets %j in the metadata schema", (offsets) => {
    expect(EventTypeMetaDataSchema.safeParse({ flowkoReminders: { enabled: true, offsets } }).success).toBe(
      false
    );
  });

  it("exports FLOWKO_REMINDER_OFFSETS as [1440, 120]", () => {
    expect(FLOWKO_REMINDER_OFFSETS).toEqual([1440, 120]);
  });

  describe("flowkoRemindersSchema on its own", () => {
    const parse = (value: unknown) => flowkoRemindersSchema.safeParse(value);

    it.each([[[60]], [[]], [[1440, 1440]]])("rejects offsets %j", (offsets) => {
      expect(parse({ enabled: true, offsets }).success).toBe(false);
    });

    it.each([[[1440]], [[120]], [[1440, 120]]])("accepts offsets %j", (offsets) => {
      expect(parse({ enabled: true, offsets }).success).toBe(true);
    });

    it("accepts enabled: false", () => {
      expect(parse({ enabled: false, offsets: [1440] }).success).toBe(true);
    });
  });
});

// Flowko U27: the mirror marker has to survive the metadata schemas (they strip unknown keys).
describe("Flowko U27: flowkoMirror in event-type metadata", () => {
  it("keeps flowkoMirror next to flowkoReminders", () => {
    const reminders = { enabled: true, offsets: [1440, 120] };
    const parsed = EventTypeMetaDataSchema.parse({ flowkoMirror: true, flowkoReminders: reminders });
    expect(parsed).toEqual({ flowkoMirror: true, flowkoReminders: reminders });
  });

  it("rejects flowkoMirror: false", () => {
    expect(EventTypeMetaDataSchema.safeParse({ flowkoMirror: false }).success).toBe(false);
  });

  it("leaves an absent flowkoMirror absent", () => {
    const parsed = EventTypeMetaDataSchema.parse({ disableSuccessPage: true });
    expect(parsed && "flowkoMirror" in parsed).toBe(false);
  });
});
