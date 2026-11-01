type Translate = (key: string, options?: Record<string, unknown>) => string;

const KEY_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/**
 * Flowko U14: an API route answers with a translation key (e.g. `booking_not_found`) in `message` and the
 * page says it in the UI language. Anything that is not a plain snake_case key, such as an English sentence
 * from a route this fork does not own, is returned as it is: i18next would split a sentence at its
 * "." and ":" and print a fragment.
 */
export function translateServerMessage(t: Translate, message: string | null | undefined): string | undefined {
  if (!message) return undefined;
  return KEY_PATTERN.test(message) ? t(message) : message;
}
