// Flowko U29a: test fixture for the settings views (not a test file): Flowko Test's settings as
// viewer.flowko.business.settings returns them, its service catalogue as viewer.flowko.services.list returns it
// (Task 8), and a `t` backed by the real locale files that resolves i18next plurals (sl _one/_two/_few/_other,
// en _one/_other) the way i18next does when `count` is given.
// Flowko U29e (E10.1): that `t` escapes interpolated strings like production's i18next (escapeValue true by
// default) unless the call opts out (RAW), so a test sees a name printed as „Ana &amp; Maja“.

import type {
  OwnerService,
  OwnerServicesView,
  ServiceColumnMember,
} from "@calcom/features/flowkoBusiness/services";
import type { BusinessSettingsView } from "@calcom/features/flowkoBusiness/settings";
import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import type { OpeningHours } from "@calcom/lib/flowkoBusiness/schemas";
import type { WorkerListBooking, WorkerListRow, WorkersList } from "@calcom/lib/flowkoBusiness/workers";

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

// Flowko U29e (E10.1): i18next's default escape (its _entityMap): & < > " ' and /.
export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\//g, "&#x2F;");

/**
 * A `t` over the real locale files: {{placeholder}} interpolation, and `count` picks the plural form first.
 * Flowko U29e (E10.1): interpolated strings are HTML-escaped as i18next does by default, unless the call passes
 * `interpolation: { escapeValue: false }` (RAW); numbers are never escaped.
 */
export function localeT(lang: "sl" | "en" = "sl") {
  const strings = localeStrings[lang];
  const rules = new Intl.PluralRules(lang);
  return (key: string, opts?: Record<string, unknown>) => {
    const count = opts?.count;
    const plural = typeof count === "number" ? strings[`${key}_${rules.select(count)}`] : undefined;
    const interpolation = opts?.interpolation as { escapeValue?: boolean } | undefined;
    const raw = interpolation?.escapeValue === false;
    return (plural ?? strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
      const value = opts?.[k];
      if (typeof value === "string") return raw ? value : escapeHtml(value);
      return String(value ?? "");
    });
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
  broken: false, // Flowko U29c: P4
  priceCents: null, // Flowko U29e: E8
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
  broken: false, // Flowko U29c: P4
  priceCents: 4500, // Flowko U29e: E8 (45,00 €; the other services have no price)
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
  broken: false, // Flowko U29c: P4
  priceCents: null, // Flowko U29e: E8
};

// Flowko U29c: a service whose stored steps are corrupt, as listServicesForOwner returns it (steps [], broken).
export const KVAR: OwnerService = {
  id: 4,
  name: "Kvar",
  category: null,
  steps: [],
  totalMinutes: 0,
  position: 3,
  workers: workers([ANA]),
  futureBookings: 0,
  broken: true,
  priceCents: null, // Flowko U29e: E8
};

/** Out of position order on purpose: the page sorts by position. */
export const SERVICES_VIEW: OwnerServicesView = { services: [BARVANJE, FEN, STRIZENJE], members: MEMBERS };

// Flowko U29c (Task 6): the owner's „Delavci“ list as viewer.flowko.workers.list returns it, in position order:
// Ana (OWNER, me), Bor (WORKER, desk-only), Cene (STAFF, no login), Dan (WORKER, LOCKED, 2 bookings), Eva (WORKER,
// login, ACTIVE), Fran (STAFF, login, ACTIVE). Never a uid or an e-mail (the server does not send them).
export const CENE = 14;
export const EVA = 15;
export const FRAN = 16;

export const DAN_BOOKINGS: WorkerListBooking[] = [
  {
    bookingId: 501,
    date: "2026-11-17",
    from: "10:00",
    to: "11:00",
    services: ["Striženje", "Fen"],
    customerName: "Ana Testna",
  },
  {
    bookingId: 502,
    date: "2027-01-05",
    from: "09:30",
    to: "10:15",
    services: ["Barvanje"],
    customerName: "Jan Novak",
  },
];

const worker = (
  over: Partial<WorkerListRow> & Pick<WorkerListRow, "memberId" | "displayName">
): WorkerListRow => ({
  role: "WORKER",
  status: "ACTIVE",
  noLogin: false,
  isMe: false,
  futureCount: 0,
  futureBookings: [],
  moreBookings: 0,
  // Flowko U29d: no open invite by default (WorkerListRow.invite, Task 2 type change).
  invite: null,
  ...over,
});

// Flowko U29d: workers.list answers { members, invites } (I9); `invites` = open invites of brand-new people.
// Flowko U29e (E5, R3): the answer type itself (WorkersList), with `ownerUsualWeek`: the owner has a usual week a new
// worker gets (true in both fixtures; the hint cases set false).
export type WorkersViewData = WorkersList;

// Flowko U29e (E10.1): a name with characters i18next would escape (the rows and dialogs must print it once).
export const AMP_NAME = "Ana & Maja";

export const WORKERS_VIEW: WorkersViewData = {
  members: [
    worker({ memberId: ANA, displayName: "Ana", role: "OWNER", isMe: true }),
    worker({ memberId: BOR, displayName: "Bor", noLogin: true }),
    worker({ memberId: CENE, displayName: "Cene", role: "STAFF", noLogin: true }),
    worker({
      memberId: DAN,
      displayName: "Dan",
      status: "LOCKED",
      futureCount: 2,
      futureBookings: DAN_BOOKINGS,
    }),
    worker({ memberId: EVA, displayName: "Eva" }),
    worker({ memberId: FRAN, displayName: "Fran", role: "STAFF" }),
  ],
  invites: [],
  ownerUsualWeek: true, // Flowko U29e: E5
};

// Flowko U29d (Task 7): the same list with open invites (U1). Bor (desk-only) has an open invite valid until Mon
// 23 Nov 08:07, Gaja (desk-only, added after Fran) an expired one; pending brand-new invites for Hana (WORKER, open)
// and Iva (STAFF, expired). NOW in the tests is Mon 2026-11-16 07:07Z (08:07 Ljubljana).
export const GAJA = 17;
export const BOR_INVITE = 71;
export const GAJA_INVITE = 72;
export const HANA_INVITE = 73;
export const IVA_INVITE = 74;

export const WORKERS_VIEW_INVITES: WorkersViewData = {
  members: [
    ...WORKERS_VIEW.members.map((m) =>
      m.memberId === BOR
        ? {
            ...m,
            invite: { inviteId: BOR_INVITE, expiresDate: "2026-11-23", expiresTime: "08:07", expired: false },
          }
        : m
    ),
    worker({
      memberId: GAJA,
      displayName: "Gaja",
      noLogin: true,
      invite: { inviteId: GAJA_INVITE, expiresDate: "2026-11-15", expiresTime: "17:30", expired: true },
    }),
  ],
  invites: [
    {
      inviteId: HANA_INVITE,
      name: "Hana",
      email: "hana@example.si",
      role: "WORKER",
      expiresDate: "2026-11-20",
      expiresTime: "09:15",
      expired: false,
    },
    {
      inviteId: IVA_INVITE,
      name: "Iva",
      email: "iva@example.si",
      role: "STAFF",
      expiresDate: "2026-11-14",
      expiresTime: "18:00",
      expired: true,
    },
  ],
  ownerUsualWeek: true, // Flowko U29e: E5
};
