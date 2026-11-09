// Flowko U29a: test fixture for the settings views (not a test file): Flowko Test's settings as
// viewer.flowko.business.settings returns them, its service catalogue as viewer.flowko.services.list returns it
// (Task 8), and a `t` backed by the real locale files that resolves i18next plurals (sl _one/_two/_few/_other,
// en _one/_other) the way i18next does when `count` is given.

import type {
  OwnerService,
  OwnerServicesView,
  ServiceColumnMember,
} from "@calcom/features/flowkoBusiness/services";
import type { BusinessSettingsView } from "@calcom/features/flowkoBusiness/settings";
import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import type { OpeningHours } from "@calcom/lib/flowkoBusiness/schemas";

export const OPENING: OpeningHours = {
  mon: [{ from: "08:00", to: "20:00" }],
  tue: [{ from: "08:00", to: "20:00" }],
  wed: [{ from: "08:00", to: "20:00" }],
  thu: [{ from: "08:00", to: "20:00" }],
  fri: [{ from: "08:00", to: "20:00" }],
  sat: [{ from: "08:00", to: "13:00" }],
  sun: [],
};

export const UPDATED_AT = new Date("2026-11-16T07:00:00.000Z");

export const SETTINGS: BusinessSettingsView = {
  name: "Flowko Test",
  slug: "flowko-test",
  timeZone: "Europe/Ljubljana",
  phone: "+386 40 123 456",
  address: "Slovenska cesta 1, Ljubljana",
  email: "salon@example.si",
  openingHours: OPENING,
  slotGridMinutes: 15,
  holidaysClosed: true,
  reminderOffsets: [1440],
  sharedDevice: false,
  callPagePath: "/poklicite/flowko-test",
  updatedAt: UPDATED_AT,
};

export const localeStrings = {
  sl: sl as unknown as Record<string, string>,
  en: en as unknown as Record<string, string>,
};

/** A `t` over the real locale files: {{placeholder}} interpolation, and `count` picks the plural form first. */
export function localeT(lang: "sl" | "en" = "sl") {
  const strings = localeStrings[lang];
  const rules = new Intl.PluralRules(lang);
  return (key: string, opts?: Record<string, unknown>) => {
    const count = opts?.count;
    const plural = typeof count === "number" ? strings[`${key}_${rules.select(count)}`] : undefined;
    return (plural ?? strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
      String(opts?.[k] ?? "")
    );
  };
}

// Flowko U29a (Task 8): Flowko Test's catalogue as viewer.flowko.services.list returns it, deliberately out of
// position order. Column members in roster order: Ana (OWNER), Bor (WORKER), Dan (WORKER, LOCKED).
export const ANA = 11;
export const BOR = 12;
export const DAN = 13;

export const MEMBERS: ServiceColumnMember[] = [
  { memberId: ANA, displayName: "Ana", role: "OWNER", status: "ACTIVE", deskOnly: false },
  { memberId: BOR, displayName: "Bor", role: "WORKER", status: "ACTIVE", deskOnly: true },
  { memberId: DAN, displayName: "Dan", role: "WORKER", status: "LOCKED", deskOnly: false },
];

const workers = (assigned: number[]) =>
  MEMBERS.map((m) => ({
    memberId: m.memberId,
    displayName: m.displayName,
    status: m.status,
    deskOnly: m.deskOnly,
    assigned: assigned.includes(m.memberId),
  }));

export const STRIZENJE: OwnerService = {
  id: 1,
  name: "Striženje",
  category: null,
  steps: [{ kind: "busy", minutes: 45 }],
  totalMinutes: 45,
  position: 0,
  workers: workers([ANA, BOR]),
  futureBookings: 0,
};

export const BARVANJE: OwnerService = {
  id: 2,
  name: "Barvanje",
  category: "Barve",
  steps: [
    { kind: "busy", minutes: 30 },
    { kind: "processing", minutes: 30 },
    { kind: "busy", minutes: 15 },
  ],
  totalMinutes: 75,
  position: 1,
  workers: workers([ANA, DAN]),
  futureBookings: 3,
};

export const FEN: OwnerService = {
  id: 3,
  name: "Fen",
  category: null,
  steps: [{ kind: "busy", minutes: 20 }],
  totalMinutes: 20,
  position: 2,
  workers: workers([]),
  futureBookings: 1,
};

/** Out of position order on purpose: the page sorts by position. */
export const SERVICES_VIEW: OwnerServicesView = { services: [BARVANJE, FEN, STRIZENJE], members: MEMBERS };
