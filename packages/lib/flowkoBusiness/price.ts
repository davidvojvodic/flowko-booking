// Flowko U29e: the price of a service (E8, plan R15). Integer euro cents, EUR only; null = no price. An own
// formatter, never Intl.NumberFormat (ICU differs between Node and browsers): „25,00 €“ and „1.250,00 €“ with a
// no-break space before „€“, always two decimals, the same text in the en and the sl UI. The parser works on digit
// strings only (never parseFloat × 100: 0.29 × 100 is 28.999…). Shown only on the desk while booking and in the
// owner's „Storitve“ (R16); never on a booking, in a mail, on the mirror EventType or on a customer page.
// Pure and client-safe: no `node:` import, no regex `u` or `g` flag (ES5 target of the trpc build).
import { SERVICE_LIMITS } from "./schemas";

const NBSP = String.fromCharCode(0xa0);
/** More euro digits than this are out of range anyway; checked before any arithmetic, so no unsafe integer. */
const EURO_DIGITS_MAX = 12;

const PLAIN_RE = /^(\d+)(?:[,.](\d{1,2}))?$/;
const GROUPED_RE = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/;
const SUFFIX_RE = /(?:€|eur)$/i;
const SPACE_RE = /\s/;

export type PriceParse =
  | { ok: true; cents: number | null }
  | { ok: false; code: "price_format" | "price_range" };

function isPriceCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** „25,50“: euros without grouping, a comma, two decimal digits. */
function plainText(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${euros},${rest < 10 ? "0" : ""}${rest}`;
}

/** „1.250,00 €“; an empty text for a value that is not a non-negative integer (callers pass a guarded price). */
export function formatPriceCents(cents: number): string {
  if (!isPriceCents(cents)) return "";
  const [euros, decimals] = plainText(cents).split(",");
  let grouped = "";
  for (let end = euros.length; end > 0; end -= 3) {
    const part = euros.slice(Math.max(0, end - 3), end);
    grouped = grouped === "" ? part : `${part}.${grouped}`;
  }
  return `${grouped},${decimals}${NBSP}€`;
}

/** The editor's text of a stored price („25,50“, no grouping, no „€“); null → "". */
export function priceTextOf(cents: number | null): string {
  return cents === null || !isPriceCents(cents) ? "" : plainText(cents);
}

/**
 * R15: what the owner typed → cents. Spaces (no-break ones too) are dropped and one trailing „€“ or „EUR“ is
 * allowed. Accepts „25“, „25,5“, „25,50“, „25.5“ and the grouped „1.250,00“; refuses „1.250“ (1250 or 1,25?),
 * more than two decimals, a sign, letters and a missing leading digit (price_format). Empty → null (no price).
 * Above SERVICE_LIMITS.priceMaxCents → price_range.
 */
export function parsePriceText(text: string): PriceParse {
  const compact = text.split(SPACE_RE).join("");
  if (compact === "") return { ok: true, cents: null };
  const number = compact.replace(SUFFIX_RE, "");
  const match = PLAIN_RE.exec(number) ?? GROUPED_RE.exec(number);
  if (!match) return { ok: false, code: "price_format" };
  const euroDigits = match[1].split(".").join("");
  if (euroDigits.length > EURO_DIGITS_MAX) return { ok: false, code: "price_range" };
  const decimals = match[2] === undefined ? "00" : match[2].length === 1 ? `${match[2]}0` : match[2];
  const cents = parseInt(euroDigits, 10) * 100 + parseInt(decimals, 10);
  if (cents > SERVICE_LIMITS.priceMaxCents) return { ok: false, code: "price_range" };
  return { ok: true, cents };
}

/**
 * The total of the chosen services: the sum of those with a price (null when none has one) and how many chosen
 * services have no price. An id that is not in `services` is ignored.
 */
export function priceTotal(
  services: ReadonlyArray<{ id: number; priceCents: number | null }>,
  ids: ReadonlyArray<number>
): { cents: number | null; unpriced: number } {
  let cents: number | null = null;
  let unpriced = 0;
  for (const id of ids) {
    const service = services.find((s) => s.id === id);
    if (!service) continue;
    if (service.priceCents === null) unpriced += 1;
    else cents = (cents ?? 0) + service.priceCents;
  }
  return { cents, unpriced };
}

/**
 * The read guard (R15): a stored priceCents that is not an integer in 0..SERVICE_LIMITS.priceMaxCents reads as no
 * price. The column has no CHECK (no migration in U29e), so a manual DB edit cannot put „-5,00 €“ on the desk.
 */
export function storedPriceCents(value: unknown): number | null {
  return isPriceCents(value) && value <= SERVICE_LIMITS.priceMaxCents ? value : null;
}
