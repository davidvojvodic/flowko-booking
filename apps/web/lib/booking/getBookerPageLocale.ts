import { i18n } from "@calcom/i18n/next-i18next.config";
import { prisma } from "@calcom/prisma";

function toSupportedLocale(locale: string | null | undefined) {
  return locale && i18n.locales.includes(locale) ? locale : null;
}

/**
 * Flowko U13-25 (David, Q9 (a)): the language of a booking page, its embed and the embedded booking success page.
 * The event type's interface language („Jezik vmesnika“, Advanced tab) wins. Without one, the page is in its owner's
 * language (Settings → General), not in the visitor's browser language (Accept-Language, upstream's fallback), so a
 * Slovenian business's booking page stays Slovenian on its website for a visitor whose browser asks for English. The
 * booker's e-mails follow the page's language, because the booking form sends it with the booking.
 *
 * Returns null when neither is set, when the owner's language is not one the app ships, and for an event type
 * without an owner (a team's); the page then keeps the root layout's language as before.
 */
export async function getEventTypePageLocale({
  interfaceLanguage,
  eventTypeId,
}: {
  interfaceLanguage?: string | null;
  eventTypeId?: number | null;
}): Promise<string | null> {
  if (interfaceLanguage) return interfaceLanguage;
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
