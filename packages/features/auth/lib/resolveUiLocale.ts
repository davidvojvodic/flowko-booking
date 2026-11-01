/**
 * Flowko U14: the language of a person's own screens. The sidebar's SL / EN choice (`metadata.uiLanguage`) wins when it
 * is one the switch offers; otherwise their language (`User.locale`), which also drives their booking pages and e-mails.
 */
export function resolveUiLocale({
  locale,
  metadata,
}: {
  locale?: string | null;
  metadata?: unknown;
}): string | null | undefined {
  const uiLanguage =
    typeof metadata === "object" && metadata !== null
      ? (metadata as { uiLanguage?: unknown }).uiLanguage
      : undefined;
  return uiLanguage === "sl" || uiLanguage === "en" ? uiLanguage : locale;
}
