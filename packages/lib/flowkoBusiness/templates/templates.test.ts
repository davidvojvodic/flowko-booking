// Flowko U25: business templates are valid data (hours, steps, unique names) and looked up safely.
import { describe, expect, it } from "vitest";
import { openingHoursSchema, SLOT_GRIDS, serviceStepsSchema } from "../schemas";
import { FLOWKO_TEMPLATES, getFlowkoTemplate } from "./index";

const templates = Object.values(FLOWKO_TEMPLATES);

describe("FLOWKO_TEMPLATES", () => {
  it.each(templates.map((t) => [t.id, t] as const))("%s: id matches its key", (id, t) => {
    expect(FLOWKO_TEMPLATES[id]).toBe(t);
  });

  it.each(templates.map((t) => [t.id, t] as const))("%s: hours and grid are valid", (_id, t) => {
    expect(openingHoursSchema.safeParse(t.openingHours).success).toBe(true);
    expect((SLOT_GRIDS as readonly number[]).includes(t.slotGridMinutes)).toBe(true);
  });

  it.each(templates.map((t) => [t.id, t] as const))("%s: every service's steps are valid", (_id, t) => {
    for (const s of t.services) {
      expect(serviceStepsSchema.safeParse(s.steps).success, s.name).toBe(true);
    }
  });

  it.each(templates.map((t) => [t.id, t] as const))("%s: service names are unique", (_id, t) => {
    const names = t.services.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("hair-salon template", () => {
  const t = FLOWKO_TEMPLATES["hair-salon"];

  it("has the six services in order, prices null", () => {
    expect(t.services).toEqual([
      {
        name: "Moško striženje",
        category: "Striženje",
        steps: [{ kind: "busy", minutes: 30 }],
        priceCents: null,
      },
      {
        name: "Žensko striženje",
        category: "Striženje",
        steps: [{ kind: "busy", minutes: 45 }],
        priceCents: null,
      },
      {
        name: "Otroško striženje",
        category: "Striženje",
        steps: [{ kind: "busy", minutes: 20 }],
        priceCents: null,
      },
      {
        name: "Barvanje",
        category: "Barvanje",
        steps: [
          { kind: "busy", minutes: 30 },
          { kind: "processing", minutes: 40 },
          { kind: "busy", minutes: 30 },
        ],
        priceCents: null,
      },
      {
        name: "Pramenčki",
        category: "Barvanje",
        steps: [
          { kind: "busy", minutes: 45 },
          { kind: "processing", minutes: 35 },
          { kind: "busy", minutes: 30 },
        ],
        priceCents: null,
      },
      {
        name: "Feniranje",
        category: "Oblikovanje",
        steps: [{ kind: "busy", minutes: 30 }],
        priceCents: null,
      },
    ]);
  });

  it("is open Mon-Fri 07-20, Sat 07-13, closed Sunday, grid 15", () => {
    const weekday = [{ from: "07:00", to: "20:00" }];
    expect(t.openingHours).toEqual({
      mon: weekday,
      tue: weekday,
      wed: weekday,
      thu: weekday,
      fri: weekday,
      sat: [{ from: "07:00", to: "13:00" }],
      sun: [],
    });
    expect(t.slotGridMinutes).toBe(15);
  });
});

describe("getFlowkoTemplate", () => {
  it("finds hair-salon", () => {
    expect(getFlowkoTemplate("hair-salon")).toBe(FLOWKO_TEMPLATES["hair-salon"]);
  });

  it.each(["x", "", "toString", "__proto__", "constructor"])("answers null for %j", (id) => {
    expect(getFlowkoTemplate(id)).toBeNull();
  });
});
