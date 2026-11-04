type Country = { code: string; name: string };

/**
 * Flowko U19: the holidays country list in the app language. Countries (two-letter codes)
 * are named with Intl.DisplayNames, the religious calendars (CHRISTIAN, ...) with
 * flowko_holiday_calendar_* keys. Slovenia comes first, then the religious calendars,
 * then the countries in the language's own alphabetical order.
 */
export function localizeHolidayCountries(
  countries: Country[],
  language: string,
  t: (key: string) => string
): Country[] {
  let regionNames: Intl.DisplayNames | null = null;
  try {
    regionNames = new Intl.DisplayNames([language], { type: "region" });
  } catch {
    regionNames = null;
  }
  const named = countries.map((country) => {
    if (country.code.length !== 2) {
      return { code: country.code, name: t(`flowko_holiday_calendar_${country.code.toLowerCase()}`) };
    }
    return { code: country.code, name: regionNames?.of(country.code) ?? country.name };
  });
  const slovenia = named.filter((c) => c.code === "SI");
  const religious = named.filter((c) => c.code.length !== 2);
  const rest = named
    .filter((c) => c.code.length === 2 && c.code !== "SI")
    .sort((a, b) => a.name.localeCompare(b.name, language));
  return [...slovenia, ...religious, ...rest];
}
