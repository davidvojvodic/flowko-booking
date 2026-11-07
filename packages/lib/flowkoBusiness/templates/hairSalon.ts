// Flowko U25: the generic Slovene hair-salon template (R12, P15): six services with their steps, prices empty
// (the owner sets them), Mon-Fri 07-20, Sat 07-13, Sunday closed, 15-minute grid. The service names and
// categories are the only new Slovene text in U25; independent Slovene read 2026-11-07: no changes.
import type { FlowkoBusinessTemplate } from "./index";

const WEEKDAY_HOURS = [{ from: "07:00", to: "20:00" }];

export const hairSalonTemplate: FlowkoBusinessTemplate = {
  id: "hair-salon",
  slotGridMinutes: 15,
  openingHours: {
    mon: WEEKDAY_HOURS,
    tue: WEEKDAY_HOURS,
    wed: WEEKDAY_HOURS,
    thu: WEEKDAY_HOURS,
    fri: WEEKDAY_HOURS,
    sat: [{ from: "07:00", to: "13:00" }],
    sun: [],
  },
  services: [
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
    { name: "Feniranje", category: "Oblikovanje", steps: [{ kind: "busy", minutes: 30 }], priceCents: null },
  ],
};
