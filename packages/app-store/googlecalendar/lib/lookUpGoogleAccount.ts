import { calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client } from "googleapis-common";
import z from "zod";

import { getGoogleAppKeys } from "./getGoogleAppKeys";

const GOOGLE_ACCOUNT_LOOKUP_TIMEOUT_MS = 5000;

const googleCalendarTokenSchema = z.object({
  access_token: z.string().nullish(),
  refresh_token: z.string().nullish(),
  expiry_date: z.number().nullish(),
});

export type GoogleAccountLookup =
  | { status: "found"; primaryCalendarId: string }
  /** Google refused the token: it was revoked, or it expired unused */
  | { status: "grant_revoked" }
  /** The request failed for another reason, timed out, or the token lacks calendar.readonly */
  | { status: "unknown" };

/**
 * Flowko: finds which Google account a stored or freshly issued token belongs to. The primary
 * calendar's id is the account's email address, and it is the same id the callback reads with
 * calendars.get('primary') on connect.
 *
 * It uses a plain OAuth2Client rather than the CalendarService, so a token refresh here writes
 * nothing to the database and never marks a credential invalid. Best effort: it never throws.
 */
export const lookUpGoogleAccount = async (key: unknown): Promise<GoogleAccountLookup> => {
  const parsedKey = googleCalendarTokenSchema.safeParse(key);
  if (!parsedKey.success || (!parsedKey.data.access_token && !parsedKey.data.refresh_token)) {
    return { status: "unknown" };
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const { client_id, client_secret, redirect_uris } = await getGoogleAppKeys();
    const auth = new OAuth2Client(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(parsedKey.data);

    const result = await Promise.race([
      new calendar_v3.Calendar({ auth }).calendars.get({ calendarId: "primary", fields: "id" }),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), GOOGLE_ACCOUNT_LOOKUP_TIMEOUT_MS);
      }),
    ]);
    if (result === "timeout" || !result.data.id) return { status: "unknown" };
    return { status: "found", primaryCalendarId: result.data.id };
  } catch (error) {
    // Never log or return the error: gaxios keeps the request, with the token, on it
    const { response, message } = (error ?? {}) as {
      response?: { data?: { error?: unknown } };
      message?: unknown;
    };
    if (response?.data?.error === "invalid_grant" || message === "invalid_grant") {
      return { status: "grant_revoked" };
    }
    return { status: "unknown" };
  } finally {
    clearTimeout(timeoutId);
  }
};
