// Flowko U26: the Slovenian work-free days (Zakon o praznikih in dela prostih dnevih v RS), so a business can
// close on them. Pure and client-safe: imports nothing from Node, only the U24 type LocalDate.
// The list is the law's work-free days ONLY, not the state holidays that remain working days (e.g. 23 November,
// Rudolf Maister day); a change in the law is an edit of FIXED_DAYS / EASTER_DAYS below. Years outside
// 2000-2199 throw RangeError (the date schema of the roster layer relies on this bound).
import type { LocalDate } from "@calcom/lib/flowkoSalon";

export type WorkFreeDay = { date: LocalDate; name: string };

const MIN_YEAR = 2000;
const MAX_YEAR = 2199;
const DAY_MS = 86_400_000;

/** Fixed-date work-free days as "MM-DD". */
const FIXED_DAYS: ReadonlyArray<readonly [string, string]> = [
  ["01-01", "novo leto"],
  ["01-02", "novo leto"],
  ["02-08", "Prešernov dan, slovenski kulturni praznik"],
  ["04-27", "dan upora proti okupatorju"],
  ["05-01", "praznik dela"],
  ["05-02", "praznik dela"],
  ["06-25", "dan državnosti"],
  ["08-15", "Marijino vnebovzetje"],
  ["10-31", "dan reformacije"],
  ["11-01", "dan spomina na mrtve"],
  ["12-25", "božič"],
  ["12-26", "dan samostojnosti in enotnosti"],
];

/** Work-free days counted from Easter Sunday, as a day offset. */
const EASTER_DAYS: ReadonlyArray<readonly [number, string]> = [
  [0, "velikonočna nedelja"],
  [1, "velikonočni ponedeljek"],
  [49, "binkoštna nedelja"],
];

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError("year_out_of_range");
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Easter Sunday of a Gregorian year (Meeus/Jones/Butcher), as "YYYY-MM-DD". */
export function easterSunday(year: number): LocalDate {
  assertYear(year);
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDays(date: LocalDate, days: number): LocalDate {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The 15 work-free days of a year, sorted by date. */
export function slovenianWorkFreeDays(year: number): WorkFreeDay[] {
  assertYear(year);
  const easter = easterSunday(year);
  const days: WorkFreeDay[] = [
    ...FIXED_DAYS.map(([md, name]) => ({ date: `${year}-${md}`, name })),
    ...EASTER_DAYS.map(([offset, name]) => ({ date: addDays(easter, offset), name })),
  ];
  return days.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The work-free day on a date, or null. RangeError on a malformed or out-of-range date. */
export function workFreeDayOn(date: LocalDate): WorkFreeDay | null {
  const match = typeof date === "string" ? DATE_RE.exec(date) : null;
  if (!match) throw new RangeError("bad_date");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError("bad_date");
  }
  assertYear(year);
  return slovenianWorkFreeDays(year).find((h) => h.date === date) ?? null;
}
