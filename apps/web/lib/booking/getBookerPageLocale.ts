import { i18n } from "@calcom/i18n/next-i18next.config";
import { prisma } from "@calcom/prisma";

function toSupportedLocale(locale: string | null | undefined) {
  return locale && i18n.locales.includes(locale) ? locale : null;
}

/**
 * Flowko U13-25 (David, Q9 (a)): the language of a booking page, its embed and the embedded booking success page.
 * An explicit interface language („Jezik vmesnika“ on, Advanced tab) always wins:
 * - a language ("sl", "en", ...): the page is in that language;
 * - "" („Jezik brskalnika obiskovalca“ / "Visitor's browser language", the toggle's default when switched on): the
 *   visitor's browser language, exactly as upstream (null here, so the root layout's Accept-Language applies).
 * Only when the toggle is off (null, every new event type) is the page in its owner's language (Settings → General)
 * instead of the visitor's browser language, so a Slovenian business's booking page stays Slovenian on its website
 * for a visitor whose browser asks for English. The booker's e-mails follow the page's language, because the booking
 * form sends it with the booking.
 *
 * Returns null for "", when the owner's language is not one the app ships, and for an event type without an owner
 * (a team's); the page then keeps the root layout's language as before.
 */
export async function getEventTypePageLocale({
  interfaceLanguage,
  eventTypeId,
}: {
  interfaceLanguage?: string | null;
  eventTypeId?: number | null;
}): Promise<string | null> {
  // "" is the explicit „Jezik brskalnika obiskovalca“ choice: keep upstream's Accept-Language, no owner lookup
  if (interfaceLanguage === "") return null;
  if (interfaceLanguage) return interfaceLanguage;
  // Only a switched-off interface language (null/undefined) falls back to the owner's
  if (!eventTypeId) return null;
  const eventType = await prisma.eventType.findUnique({
    where: { id: eventTypeId },
    select: { owner: { select: { locale: true } } },
  });
  return toSupportedLocale(eventType?.owner?.locale);
}

/**
 * Flowko U13-25: the language of a user's embedded page (the list of their event types), which has no event type to
 * take a language from: the user's own language, or null to keep the root layout's.
 */
export async function getUserPageLocale(username: string | null | undefined): Promise<string | null> {
  if (!username) return null;
  // The same user the page shows: a user outside an organization (UserRepository.findUsersByUsername)
  const user = await prisma.user.findFirst({
    where: { username, organizationId: null },
    select: { locale: true },
  });
  return toSupportedLocale(user?.locale);
}
