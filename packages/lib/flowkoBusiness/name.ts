// Flowko U25: the shape of a business slug (`/<business>`). Business slugs and usernames share one name
// space (packages/features/flowkoBusiness/nameSpace.ts). Pure and client-safe: no `node:` import here.
// The pattern is required, not optional: `slugify` keeps non-ASCII letters (`ł`, `ß`).

export const FLOWKO_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const FLOWKO_SLUG_MIN_LENGTH = 2;
export const FLOWKO_SLUG_MAX_LENGTH = 60;

/** True when `name` is lowercase ASCII letters and digits in hyphen-separated runs, 2 to 60 characters. */
export function isFlowkoSlugShape(name: string): boolean {
  return (
    name.length >= FLOWKO_SLUG_MIN_LENGTH &&
    name.length <= FLOWKO_SLUG_MAX_LENGTH &&
    FLOWKO_SLUG_PATTERN.test(name)
  );
}
