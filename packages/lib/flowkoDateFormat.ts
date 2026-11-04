/**
 * U18 (Flowko): Slovene writes the day of the month with an ordinal dot („4. nov.“, „2. november 2026“).
 * dayjs's "D" token has none, so formats used for a Slovene reader get one after a lone "D".
 */
export const withOrdinalDot = (format: string, language: string | null | undefined): string =>
  language?.toLowerCase().startsWith("sl") ? format.replace(/(^|[^D])D(?![D.o])/g, "$1D.") : format;
