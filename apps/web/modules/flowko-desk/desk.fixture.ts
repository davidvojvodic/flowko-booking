// Flowko U28: test fixture of the desk day view (not a test file). Monday 2026-11-16 in Europe/Ljubljana (UTC+1),
// NOW = 07:07Z = 08:07 local, grid 15 min. Owner Olga, workers Ana and Bor (Google unavailable), desk-only Cene,
// locked Dan with one booking. Ana's Barvanje: busy 09:00-09:30, processing 09:30-10:10, busy 10:10-10:40.
import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import type { DeskBooking, DeskMember, DeskService, DeskView } from "@calcom/features/flowkoBusiness/desk";
// Flowko U29b: the Urnik answer's type (type only: the features module is server code).
import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";
import {
  resolveMemberDay,
  type ShiftEntry,
  type WeekHours,
  weekDates,
  weekdayOf,
} from "@calcom/lib/flowkoBusiness/roster";
import { type LocalDate, wallClockToMs } from "@calcom/lib/flowkoSalon";

export const TZ = "Europe/Ljubljana";
export const DATE = "2026-11-16";
export const NOW = new Date("2026-11-16T07:07:00Z");
export const OLGA = 1;
export const ANA = 2;
export const BOR = 3;
export const CENE = 4;
export const DAN = 6;

export const at = (hm: string, date: string = DATE) => wallClockToMs(date, hm, TZ);
export const iso = (hm: string, date: string = DATE) => new Date(at(hm, date)).toISOString();
export const iv = (from: string, to: string, date: string = DATE) => ({
  start: at(from, date),
  end: at(to, date),
});

export function booking(
  over: Partial<DeskBooking> & Pick<DeskBooking, "bookingId" | "memberId">
): DeskBooking {
  return {
    status: "ACCEPTED",
    start: iso("11:00"),
    end: iso("11:30"),
    title: "Moško striženje med Salon in Stranka",
    customer: { name: "Stranka", phone: "+38641123456", email: null },
    serviceNames: ["Moško striženje"],
    serviceIds: [2],
    steps: null,
    noShow: false,
    mayCancel: true,
    mayMove: true,
    mayNoShow: false,
    mayReenter: true,
    actions: [],
    ...over,
  } as DeskBooking;
}

export const barvanje = booking({
  bookingId: 101,
  memberId: ANA,
  start: iso("09:00"),
  end: iso("10:40"),
  title: "Barvanje",
  customer: { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" },
  serviceNames: ["Barvanje"],
  serviceIds: [1],
  steps: [
    { kind: "busy", start: iso("09:00"), end: iso("09:30"), serviceName: "Barvanje" },
    { kind: "processing", start: iso("09:30"), end: iso("10:10"), serviceName: "Barvanje" },
    { kind: "busy", start: iso("10:10"), end: iso("10:40"), serviceName: "Barvanje" },
  ],
});

export function deskView(over: Partial<DeskView["days"][number]> = {}, date: string = DATE): DeskView {
  return {
    timeZone: TZ,
    slotStepMinutes: 15,
    now: NOW.toISOString(),
    me: { memberId: OLGA, role: "OWNER" },
    days: [
      {
        date,
        opening: [iv("08:00", "19:00", date)],
        holiday: null,
        columns: [
          {
            memberId: OLGA,
            displayName: "Olga",
            deskOnly: false,
            isMe: true,
            locked: false,
            shifts: [iv("08:00", "16:00", date)],
            timeOff: [],
            otherBusy: [iv("12:00", "13:00", date)],
            googleUnavailable: false,
          },
          {
            memberId: ANA,
            displayName: "Ana",
            deskOnly: false,
            isMe: false,
            locked: false,
            shifts: [iv("08:00", "16:00", date)],
            timeOff: [iv("14:00", "15:00", date)],
            otherBusy: [],
            googleUnavailable: false,
          },
          {
            memberId: BOR,
            displayName: "Bor",
            deskOnly: false,
            isMe: false,
            locked: false,
            shifts: [iv("12:00", "20:00", date)],
            timeOff: [],
            otherBusy: [],
            googleUnavailable: true,
          },
          {
            memberId: CENE,
            displayName: "Cene",
            deskOnly: true,
            isMe: false,
            locked: false,
            shifts: [iv("08:00", "12:00", date)],
            timeOff: [],
            otherBusy: [],
            googleUnavailable: false,
          },
          {
            memberId: DAN,
            displayName: "Dan",
            deskOnly: false,
            isMe: false,
            locked: true,
            shifts: [],
            timeOff: [],
            otherBusy: [],
            googleUnavailable: false,
          },
        ],
        bookings: [
          barvanje,
          booking({ bookingId: 102, memberId: BOR, start: iso("13:00"), end: iso("13:30") }),
          booking({ bookingId: 103, memberId: DAN, mayMove: false, mayReenter: false }),
        ],
        ...over,
      },
    ],
  };
}

/** Wednesday 2026-11-18 10:00-10:30, Ana's second booking of the week. */
export const wednesdayCut = booking({
  bookingId: 201,
  memberId: ANA,
  start: iso("10:00", "2026-11-18"),
  end: iso("10:30", "2026-11-18"),
  customer: { name: "Petra Kos", phone: "+38641765432", email: null },
});

/**
 * The week view answer (Task 8): `memberId`'s column on each of the 7 days from `weekStart`. Bookings only on
 * the fixture's own dates: Monday 16th (Barvanje for Ana, Bor's 13:00) and Wednesday 18th (Ana's cut).
 */
export function weekViewOf(memberId: number = ANA, weekStart: string = DATE): DeskView {
  const base = deskView();
  const days = weekDates(weekStart).map((date) => {
    const day = deskView({}, date).days[0];
    const bookings = [...base.days[0].bookings, wednesdayCut].filter(
      (b) => b.memberId === memberId && b.start.slice(0, 10) === date
    );
    return { ...day, columns: day.columns.filter((c) => c.memberId === memberId), bookings };
  });
  return { ...base, days };
}

export const members: DeskMember[] = [
  { memberId: OLGA, displayName: "Olga", role: "OWNER", hasColumn: true, deskOnly: false },
  { memberId: ANA, displayName: "Ana", role: "WORKER", hasColumn: true, deskOnly: false },
  { memberId: BOR, displayName: "Bor", role: "WORKER", hasColumn: true, deskOnly: false },
  { memberId: CENE, displayName: "Cene", role: "WORKER", hasColumn: true, deskOnly: true },
  { memberId: 5, displayName: "Rok", role: "STAFF", hasColumn: false, deskOnly: false },
];

/** Flowko U29a (S7): a `useFlowkoBusiness()` answer for a member of business 9; `sharedDevice` = the owner's switch. */
export function businessMe(memberId: number, role: DeskMember["role"], sharedDevice: boolean) {
  return { status: "member" as const, me: { businessId: 9, memberId, role, sharedDevice } };
}

/** Barvanje (Ana, Olga), Moško striženje (Olga, Ana, Bor), Fen (Ana, Bor). */
export const services: DeskService[] = [
  {
    id: 1,
    name: "Barvanje",
    category: "Barvanje",
    steps: [
      { kind: "busy", minutes: 30 },
      { kind: "processing", minutes: 40 },
      { kind: "busy", minutes: 30 },
    ],
    totalMinutes: 100,
    priceCents: null, // Flowko U29e: E8
    workerMemberIds: [OLGA, ANA],
  },
  {
    id: 2,
    name: "Moško striženje",
    category: "Striženje",
    steps: [{ kind: "busy", minutes: 30 }],
    totalMinutes: 30,
    priceCents: null, // Flowko U29e: E8
    workerMemberIds: [OLGA, ANA, BOR],
  },
  {
    id: 3,
    name: "Fen",
    category: null,
    steps: [{ kind: "busy", minutes: 20 }],
    totalMinutes: 20,
    priceCents: null, // Flowko U29e: E8
    workerMemberIds: [ANA, BOR],
  },
];

/** A `t` backed by the real locale files, with {{placeholder}} interpolation (BookingSuccessCard.test precedent). */
export function localeT(lang: "sl" | "en" = "sl") {
  const strings = (lang === "sl" ? sl : en) as unknown as Record<string, string>;
  // Flowko U29b: `count` picks the plural form first (_one/_two/_few/_other), as i18next does.
  const rules = new Intl.PluralRules(lang);
  return (key: string, opts?: Record<string, unknown>) => {
    const count = opts?.count;
    const plural = typeof count === "number" ? strings[`${key}_${rules.select(count)}`] : undefined;
    return (plural ?? strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
      String(opts?.[k] ?? "")
    );
  };
}

// Flowko U29b: the Urnik answer (viewer.flowko.roster.week) for the same people and week. Opening Mon–Fri
// 08:00–19:00, Sat 08:00–13:00, Sun closed. Usual weeks: Olga Mon–Fri 08–16; Ana Mon–Fri 08–16 + Sat 08–13; Bor
// Tue–Sat 12–19; Cene (desk-only) none; Dan (LOCKED) Mon–Fri 09–17. Planned in the week of the 16th: Bor Wed 18
// „Prosto“ ([]) and Thu 19 10:00–14:00. Ana is absent on Fri 20 (absence 71). Versions: weekVersion "a…" and
// usualVersion "b…", each ending in the member id (64 hex characters, as the server's sha256).
const shift = (from: string, to: string): ShiftEntry => ({ from, to });
const week = (days: Partial<WeekHours>): WeekHours => ({
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
  ...days,
});
const weekdays = (entries: ShiftEntry[]) => ({
  mon: entries,
  tue: entries,
  wed: entries,
  thu: entries,
  fri: entries,
});

export const ROSTER_OPENING: WeekHours = week({
  ...weekdays([shift("08:00", "19:00")]),
  sat: [shift("08:00", "13:00")],
});

export const weekVersionOf = (memberId: number) => `${"a".repeat(63)}${memberId.toString(16)}`;
export const usualVersionOf = (memberId: number) => `${"b".repeat(63)}${memberId.toString(16)}`;

type RosterMember = RosterWeekView["members"][number];

/**
 * One member's row of a roster week: `planned` per date (an empty list = a planned day off), else the usual
 * week, else nothing (resolveMemberDay's rule); `absences` mark their dates absent.
 */
export function rosterMember(
  memberId: number,
  displayName: string,
  over: {
    usualWeek: WeekHours | null;
    planned?: Record<LocalDate, ShiftEntry[]>;
    absences?: RosterMember["absences"];
    status?: RosterMember["status"];
    deskOnly?: boolean;
  },
  weekStart: LocalDate = DATE
): RosterMember {
  const absences = over.absences ?? [];
  return {
    memberId,
    displayName,
    deskOnly: over.deskOnly ?? false,
    status: over.status ?? "ACTIVE",
    usualWeek: over.usualWeek,
    weekVersion: weekVersionOf(memberId),
    usualVersion: usualVersionOf(memberId),
    days: weekDates(weekStart).map((date) => {
      const planned = over.planned?.[date] ?? null;
      const day = resolveMemberDay({ usualWeek: over.usualWeek, planned, absent: false }, date, TZ);
      const absent = absences.some((a) => a.startDate <= date && date <= a.endDate);
      return { date, source: day.source, entries: day.entries, absent };
    }),
    absences,
  };
}

/** The roster week of the 16th as the owner Olga reads it (every column member editable, today = the 16th). */
export function rosterWeek(overrides: Partial<RosterWeekView> = {}): RosterWeekView {
  const weekStart = overrides.weekStart ?? DATE;
  return {
    businessId: 9,
    timeZone: TZ,
    weekStart,
    today: DATE,
    lastWritableWeekStart: "2027-11-22",
    holidaysClosed: true,
    days: weekDates(weekStart).map((date) => ({
      date,
      opening: ROSTER_OPENING[weekdayOf(date)],
      holiday: null,
    })),
    members: [
      rosterMember(OLGA, "Olga", { usualWeek: week(weekdays([shift("08:00", "16:00")])) }, weekStart),
      rosterMember(
        ANA,
        "Ana",
        {
          usualWeek: week({ ...weekdays([shift("08:00", "16:00")]), sat: [shift("08:00", "13:00")] }),
          absences: weekStart === DATE ? [{ id: 71, startDate: "2026-11-20", endDate: "2026-11-20" }] : [],
        },
        weekStart
      ),
      rosterMember(
        BOR,
        "Bor",
        {
          usualWeek: week({
            tue: [shift("12:00", "19:00")],
            wed: [shift("12:00", "19:00")],
            thu: [shift("12:00", "19:00")],
            fri: [shift("12:00", "19:00")],
            sat: [shift("08:00", "13:00")],
          }),
          planned: weekStart === DATE ? { "2026-11-18": [], "2026-11-19": [shift("10:00", "14:00")] } : {},
        },
        weekStart
      ),
      rosterMember(CENE, "Cene", { usualWeek: null, deskOnly: true }, weekStart),
      rosterMember(
        DAN,
        "Dan",
        { usualWeek: week(weekdays([shift("09:00", "17:00")])), status: "LOCKED" },
        weekStart
      ),
    ],
    canEditUsualWeek: true,
    editableMemberIds: [OLGA, ANA, BOR, CENE, DAN],
    ...overrides,
  };
}
