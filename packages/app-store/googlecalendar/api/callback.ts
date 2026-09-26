import { calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client } from "googleapis-common";
import type { NextApiRequest, NextApiResponse } from "next";

import { createGoogleCalendarServiceWithGoogleType } from "@calcom/app-store/googlecalendar/lib/CalendarService";
import { revokeUnstoredGoogleCalendarToken } from "@calcom/features/credentials/handleDeleteCredential";
import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import {
  buildCredentialCreateData,
  isCredentialKeyringConfigured,
} from "@calcom/features/credentials/services/CredentialDataService";
import { renewSelectedCalendarCredentialId } from "@calcom/lib/connectedCalendar";
import { GOOGLE_CALENDAR_SCOPES, WEBAPP_URL, WEBAPP_URL_FOR_OAUTH } from "@calcom/lib/constants";
import { getSafeRedirectUrl } from "@calcom/lib/getSafeRedirectUrl";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import { defaultHandler } from "@calcom/lib/server/defaultHandler";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import prisma from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";

import getInstalledAppPath from "../../_utils/getInstalledAppPath";
import { decodeOAuthState } from "../../_utils/oauth/decodeOAuthState";
import type { IntegrationOAuthCallbackState } from "../../types";
import { getGoogleAppKeys } from "../lib/getGoogleAppKeys";
import {
  findEarlierGoogleCalendarCredentials,
  replaceEarlierGoogleCalendarCredentials,
} from "../lib/replaceEarlierCredentials";
import { calendarConnectionsUnavailableError } from "./add";

const log = logger.getSubLogger({ prefix: ["googlecalendar/callback"] });

/**
 * Flowko U9: the app pages that turn ?error=<key> into a toast (isCalendarConnectError in
 * apps/web/lib/apps/calendarConnectError.ts): CalendarListContainer on Settings → Calendars and on the installed
 * calendars, and slug-view on the Google Calendar app page. Every other page ignores ?error=, so a refusal sent
 * there would be silent.
 */
const PAGES_THAT_SHOW_CALENDAR_CONNECT_ERRORS = [
  "/settings/my-account/calendars",
  "/apps/installed/calendar",
  "/apps/google-calendar",
];

const showsCalendarConnectErrors = (pageUrl: string) => {
  const url = new URL(pageUrl);
  return (
    url.origin === new URL(WEBAPP_URL).origin &&
    PAGES_THAT_SHOW_CALENDAR_CONNECT_ERRORS.includes(url.pathname.replace(/\/+$/, ""))
  );
};

/** The ?error= keys this callback sends; the pages above show only the whitelisted ones as a toast. */
type CalendarConnectErrorKey =
  | "google_calendar_connections_unavailable"
  | "account_already_linked"
  | "something_went_wrong";

/** state.onErrorReturnTo when it is a page of this app; a relative or malformed value counts as missing. */
function getSafeOnErrorReturnTo(state: IntegrationOAuthCallbackState): string | null {
  try {
    return getSafeRedirectUrl(state.onErrorReturnTo);
  } catch {
    // Not an absolute URL: treated as missing
    return null;
  }
}

/**
 * Flowko: where a refused connect sends the host, with ?error=<i18n key>. That is the page the host started it
 * from when that page shows ?error= as a toast, and otherwise the installed calendars, which do: onboarding, the
 * app categories, the event-type calendar selector and the troubleshooter start a connect too but show no
 * ?error=. Built with the URL API, because the installed calendars' path already carries ?hl=google-calendar:
 * appending "?error=" to it gave a second "?" and the page never saw the error.
 */
function calendarConnectErrorUrl(onErrorReturnTo: string | null, error: CalendarConnectErrorKey): string {
  const url = new URL(
    onErrorReturnTo && showsCalendarConnectErrors(onErrorReturnTo)
      ? onErrorReturnTo
      : getInstalledAppPath({ variant: "calendar", slug: "google-calendar" }),
    WEBAPP_URL
  );
  url.searchParams.set("error", error);
  return url.toString();
}

/**
 * Flowko U9: a connect refused because the token can't be stored encrypted goes back to the page the host
 * started it from, when that page shows ?error=<i18n key> as a toast, and otherwise to the installed calendars,
 * which do, instead of a bare JSON page with no way back. Only a flow that has no page in the app to return to
 * keeps the localised 503 JSON answer.
 */
async function refuseCalendarConnection(
  req: NextApiRequest,
  res: NextApiResponse,
  state: IntegrationOAuthCallbackState
) {
  const onErrorReturnTo = getSafeOnErrorReturnTo(state);
  if (!onErrorReturnTo && !state.fromApp) {
    throw await calendarConnectionsUnavailableError(req);
  }
  res.redirect(calendarConnectErrorUrl(onErrorReturnTo, "google_calendar_connections_unavailable"));
}

async function getHandler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;
  const state = decodeOAuthState(req);

  if (typeof code !== "string") {
    if (state?.onErrorReturnTo || state?.returnTo) {
      res.redirect(
        getSafeRedirectUrl(state.onErrorReturnTo) ??
          getSafeRedirectUrl(state?.returnTo) ??
          `${WEBAPP_URL}/apps/installed`
      );
      return;
    }
    throw new HttpError({ statusCode: 400, message: "`code` must be a string" });
  }

  if (!req.session?.user?.id) {
    throw new HttpError({ statusCode: 401, message: "You must be logged in to do this" });
  }

  // Flowko: redeem the code only for the user who started this connect flow. decodeOAuthState returns
  // undefined for a state that is missing, has no nonce, or whose nonce was signed for another user, so a
  // victim who opens an attacker's callback link can't get the attacker's Google account attached (login CSRF)
  if (!state) {
    throw new HttpError({ statusCode: 403, message: "Invalid OAuth state" });
  }

  // Flowko U9: tokens are stored only encrypted, so without the credential keyring the code must not be
  // redeemed: no token is issued that could not be stored
  if (!isCredentialKeyringConfigured()) {
    log.error("Credential keyring is not configured: Google Calendar connect refused");
    await refuseCalendarConnection(req, res, state);
    return;
  }

  const { client_id, client_secret } = await getGoogleAppKeys();

  const redirect_uri = `${WEBAPP_URL_FOR_OAUTH}/api/integrations/googlecalendar/callback`;

  const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uri);

  if (code) {
    const token = await oAuth2Client.getToken(code);
    const key = token.tokens;
    const grantedScopes = token.tokens.scope?.split(" ") ?? [];
    // Check if we have granted all required permissions
    const hasMissingRequiredScopes = GOOGLE_CALENDAR_SCOPES.some((scope) => !grantedScopes.includes(scope));
    if (hasMissingRequiredScopes) {
      // Flowko: this token is discarded, so end its grant at Google too, unless another connection shares it
      await revokeUnstoredGoogleCalendarToken({ userId: req.session.user.id, key });
      if (!state?.fromApp) {
        throw new HttpError({
          statusCode: 400,
          message: "You must grant all permissions to use this integration",
        });
      }
      res.redirect(
        getSafeRedirectUrl(state.onErrorReturnTo) ??
          getSafeRedirectUrl(state?.returnTo) ??
          `${WEBAPP_URL}/apps/installed`
      );
      return;
    }

    oAuth2Client.setCredentials(key);

    let gcalCredential: Awaited<ReturnType<typeof CredentialRepository.create>>;
    try {
      const gcalCredentialData = buildCredentialCreateData({
        userId: req.session.user.id,
        key,
        appId: "google-calendar",
        type: "google_calendar",
      });
      gcalCredential = await CredentialRepository.create(gcalCredentialData);
    } catch {
      // Flowko U9: the token could not be stored (encrypted), so end its grant at Google instead of leaving a
      // live grant that no row can revoke, and answer without details
      log.error("Google Calendar credential not stored: its fresh grant is revoked", {
        userId: req.session.user.id,
      });
      await revokeUnstoredGoogleCalendarToken({ userId: req.session.user.id, key });
      await refuseCalendarConnection(req, res, state);
      return;
    }

    const gCalService = createGoogleCalendarServiceWithGoogleType({
      ...gcalCredential,
      user: null,
      delegatedTo: null,
    });

    const calendar = new calendar_v3.Calendar({
      auth: oAuth2Client,
    });

    const primaryCal = await gCalService.getPrimaryCalendar(calendar);

    // If we still don't have a primary calendar skip creating the selected calendar.
    // It can be toggled on later.
    if (!primaryCal?.id) {
      res.redirect(
        getSafeRedirectUrl(state?.returnTo) ??
          getInstalledAppPath({ variant: "calendar", slug: "google-calendar" })
      );
      return;
    }

    const selectedCalendarWhereUnique = {
      userId: req.session.user.id,
      externalId: primaryCal.id,
      integration: "google_calendar",
    };

    // Flowko: read before the upsert below moves the primary calendar's SelectedCalendar to the
    // new credential
    const earlierCredentialsToReplace = {
      userId: req.session.user.id,
      credentialId: gcalCredential.id,
      primaryCalendarId: primaryCal.id,
      earlierCredentials: await findEarlierGoogleCalendarCredentials({
        userId: req.session.user.id,
        credentialId: gcalCredential.id,
        primaryCalendarId: primaryCal.id,
      }),
      listNewConnectionCalendars: () => gCalService.listCalendars(),
    };

    // Wrapping in a try/catch to reduce chance of race conditions-
    // also this improves performance for most of the happy-paths.
    try {
      await gCalService.upsertSelectedCalendar({
        // First install should add a user-level selectedCalendar only.
        eventTypeId: null,
        externalId: selectedCalendarWhereUnique.externalId,
      });
    } catch (error) {
      let errorMessage: CalendarConnectErrorKey = "something_went_wrong";
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // it is possible a selectedCalendar was orphaned, in this situation-
        // we want to recover by connecting the existing selectedCalendar to the new Credential.
        if (await renewSelectedCalendarCredentialId(selectedCalendarWhereUnique, gcalCredential.id)) {
          await replaceEarlierGoogleCalendarCredentials(earlierCredentialsToReplace);
          res.redirect(
            getSafeRedirectUrl(state?.returnTo) ??
              getInstalledAppPath({ variant: "calendar", slug: "google-calendar" })
          );
          return;
        }
        // else
        errorMessage = "account_already_linked";
      }
      await CredentialRepository.deleteById({ id: gcalCredential.id });
      // Flowko: upstream appended "?error=" to a path that may already have a query, and a relative
      // onErrorReturnTo made getSafeRedirectUrl throw after the credential was deleted (a 500)
      res.redirect(calendarConnectErrorUrl(getSafeOnErrorReturnTo(state), errorMessage));
      return;
    }

    // Flowko: a reconnect of the same Google account replaces the earlier credential instead of keeping both
    await replaceEarlierGoogleCalendarCredentials(earlierCredentialsToReplace);
  }

  // Flowko: install Google Meet alongside only while the admin has it switched on (App.enabled), like
  // the refused routes of every other disabled app
  const installGoogleVideo =
    state.installGoogleVideo &&
    (await prisma.app.findUnique({ where: { slug: "google-meet" }, select: { enabled: true } }))?.enabled;

  // No need to install? Redirect to the returnTo URL
  if (!installGoogleVideo) {
    res.redirect(
      getSafeRedirectUrl(state?.returnTo) ??
        getInstalledAppPath({ variant: "calendar", slug: "google-calendar" })
    );
    return;
  }

  const existingGoogleMeetCredential = await CredentialRepository.findFirstByUserIdAndType({
    userId: req.session.user.id,
    type: "google_video",
  });

  // If the user already has a google meet credential, there's nothing to do in here
  if (existingGoogleMeetCredential) {
    res.redirect(
      getSafeRedirectUrl(`${WEBAPP_URL}/apps/installed/conferencing?hl=google-meet`) ??
        getInstalledAppPath({ variant: "conferencing", slug: "google-meet" })
    );
    return;
  }

  // Create a new google meet credential
  const googleMeetCredentialData = buildCredentialCreateData({
    userId: req.session.user.id,
    type: "google_video",
    key: {},
    appId: "google-meet",
  });
  await CredentialRepository.create(googleMeetCredentialData);
  res.redirect(
    getSafeRedirectUrl(`${WEBAPP_URL}/apps/installed/conferencing?hl=google-meet`) ??
      getInstalledAppPath({ variant: "conferencing", slug: "google-meet" })
  );
}

export default defaultHandler({
  GET: Promise.resolve({ default: defaultResponder(getHandler) }),
});
