/*
 * Detects navigator locale 24h time preference
 * It works by checking whether hour output contains AM ('1 AM' or '01 h')
 * based on the user's preferred language
 * defaults to 'en-US' (12h) if no navigator language is found
 */
import { localStorage } from "@calcom/lib/webstorage";

const is24hLocalstorageKey = "timeOption.is24hClock";

export enum TimeFormat {
  TWELVE_HOUR = "h:mma",
  TWENTY_FOUR_HOUR = "HH:mm",
}

export const setIs24hClockInLocalStorage = (is24h: boolean) =>
  localStorage.setItem(is24hLocalstorageKey, is24h.toString());

export const getIs24hClockFromLocalStorage = () => {
  const is24hFromLocalstorage = localStorage.getItem(is24hLocalstorageKey);

  if (is24hFromLocalstorage === null) return null;

  return is24hFromLocalstorage === "true";
};

export const getTimeFormatStringFromUserTimeFormat = (timeFormat: number | null | undefined): TimeFormat => {
  return timeFormat === 24 ? TimeFormat.TWENTY_FOUR_HOUR : TimeFormat.TWELVE_HOUR;
};

/**
 * Returns the time format conventionally used by the given locale,
 * e.g. 12h for "en" and 24h for "sl". Falls back to 12h for an invalid locale.
 */
export const getTimeFormatForLocale = (locale: string): TimeFormat => {
  try {
    const { hourCycle } = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions();
    return hourCycle === "h23" || hourCycle === "h24" ? TimeFormat.TWENTY_FOUR_HOUR : TimeFormat.TWELVE_HOUR;
  } catch {
    return TimeFormat.TWELVE_HOUR;
  }
};

/**
 * Returns the time format for a recipient who has no time format of their own.
 * User.timeFormat defaults to 12h, so only an explicit 24h is kept and otherwise
 * the recipient's locale decides, e.g. 12h for "en" and 24h for "sl".
 */
export const getRecipientTimeFormat = (timeFormat: TimeFormat | undefined, locale: string): TimeFormat => {
  return timeFormat === TimeFormat.TWENTY_FOUR_HOUR
    ? TimeFormat.TWENTY_FOUR_HOUR
    : getTimeFormatForLocale(locale);
};

/**
 * Retrieves the browsers time format preference, checking local storage first
 * for a user set preference. If no preference is found, it will use the browser
 * locale to determine the time format and store it in local storage.
 */
export const isBrowserLocale24h = () => {
  const localStorageTimeFormat = getIs24hClockFromLocalStorage();
  // If time format is already stored in the browser then retrieve and return early
  if (localStorageTimeFormat === true) {
    return true;
  } else if (localStorageTimeFormat === false) {
    return false;
  }
  // Intl.DateTimeFormat with value=undefined uses local browser settings.
  if (!!new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(0).match(/M/i)) {
    setIs24hClockInLocalStorage(false);
    return false;
  } else {
    setIs24hClockInLocalStorage(true);
    return true;
  }
};

/**
 * Returns the time format string based on whether the current set locale is 24h or 12h.
 */
export const detectBrowserTimeFormat = isBrowserLocale24h()
  ? TimeFormat.TWENTY_FOUR_HOUR
  : TimeFormat.TWELVE_HOUR;
