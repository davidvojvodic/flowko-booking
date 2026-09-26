/**
 * The ?error= values a calendar connect callback sends back to the page the connect started from
 * (state.onErrorReturnTo), which that page shows as a toast. Only these i18n keys are shown: the parameter
 * comes from a link anyone can craft.
 */
const CALENDAR_CONNECT_ERRORS = [
  "account_already_linked",
  "no_default_calendar",
  // Flowko U9: the Google Calendar callback refused a connect because the token could not be stored encrypted
  "google_calendar_connections_unavailable",
  // Flowko U10: the Google Calendar callback could not store the selected calendar (not a duplicate account)
  "something_went_wrong",
] as const;

export type CalendarConnectError = (typeof CALENDAR_CONNECT_ERRORS)[number];

export const isCalendarConnectError = (error: string | null | undefined): error is CalendarConnectError =>
  (CALENDAR_CONNECT_ERRORS as readonly (string | null | undefined)[]).includes(error);
