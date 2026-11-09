// Flowko U28: test fixture of the desk day view (not a test file). Monday 2026-11-16 in Europe/Ljubljana (UTC+1),
// NOW = 07:07Z = 08:07 local, grid 15 min. Owner Olga, workers Ana and Bor (Google unavailable), desk-only Cene,
// locked Dan with one booking. Ana's Barvanje: busy 09:00-09:30, processing 09:30-10:10, busy 10:10-10:40.
import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import type { DeskBooking, DeskMember, DeskService, DeskView } from "@calcom/features/flowkoBusiness/desk";
import { weekDates } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";

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
    workerMemberIds: [OLGA, ANA],
  },
  {
    id: 2,
    name: "Moško striženje",
    category: "Striženje",
    steps: [{ kind: "busy", minutes: 30 }],
    totalMinutes: 30,
    workerMemberIds: [OLGA, ANA, BOR],
  },
  {
    id: 3,
    name: "Fen",
    category: null,
    steps: [{ kind: "busy", minutes: 20 }],
    totalMinutes: 20,
    workerMemberIds: [ANA, BOR],
  },
];

/** A `t` backed by the real locale files, with {{placeholder}} interpolation (BookingSuccessCard.test precedent). */
export function localeT(lang: "sl" | "en" = "sl") {
  const strings = (lang === "sl" ? sl : en) as unknown as Record<string, string>;
  return (key: string, opts?: Record<string, unknown>) =>
    (strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts?.[k] ?? ""));
}
