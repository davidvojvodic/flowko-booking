import type { TFunction } from "i18next";

/**
 * Flowko U9: the toast text for a failed viewer.credentials.delete. A CONFLICT is handleDeleteCredential's
 * refusal (HttpError 409) to remove a Google Calendar connection while its stored key is unavailable: nothing
 * was changed, so the host is told to try again later. It is worded here, in the UI's own language, because the
 * server words its message by the stored user locale, which can be empty (then English) while the UI follows the
 * browser. Every other failure keeps the generic message.
 */
export const removeAppErrorMessage = (
  error: { data?: { code?: string } | null } | null | undefined,
  t: TFunction
): string =>
  error?.data?.code === "CONFLICT" ? t("google_calendar_removal_unavailable") : t("error_removing_app");
