import process from "node:process";

import { OAuth2Client } from "googleapis-common";
import type { NextApiRequest, NextApiResponse } from "next";

import { getLocale } from "@calcom/features/auth/lib/getLocale";
import { isCredentialKeyringConfigured } from "@calcom/features/credentials/services/CredentialDataService";
import { getTranslation } from "@calcom/i18n/server";
import { GOOGLE_CALENDAR_SCOPES, WEBAPP_URL_FOR_OAUTH } from "@calcom/lib/constants";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import { defaultHandler } from "@calcom/lib/server/defaultHandler";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";

import { encodeOAuthState } from "../../_utils/oauth/encodeOAuthState";
import { getGoogleAppKeys } from "../lib/getGoogleAppKeys";

const log = logger.getSubLogger({ prefix: ["googlecalendar/add"] });

async function getHandler(req: NextApiRequest, res: NextApiResponse) {
  const loggedInUser = req.session?.user;

  if (!loggedInUser) {
    throw new HttpError({ statusCode: 401, message: "You must be logged in to do this" });
  }

  // Ideally this should never happen, as email is there in session user but typings aren't accurate it seems
  // TODO: So, confirm and later fix the typings
  if (!loggedInUser.email) {
    throw new HttpError({ statusCode: 400, message: "Session user must have an email" });
  }

  // Flowko: the callback accepts only a state whose nonce is signed with NEXTAUTH_SECRET, so without it
  // the flow could never finish; refuse before sending the user through Google's consent screen
  if (!process.env.NEXTAUTH_SECRET) {
    throw new HttpError({
      statusCode: 500,
      message: "NEXTAUTH_SECRET is not set, so the OAuth state can't be signed",
    });
  }

  // Flowko U9: tokens are stored only encrypted, so without the credential keyring the callback could not
  // store them; refuse before Google's consent screen, so no grant is created
  if (!isCredentialKeyringConfigured()) {
    log.error("Credential keyring is not configured: Google Calendar connect refused");
    throw await calendarConnectionsUnavailableError(req);
  }

  const { client_id, client_secret } = await getGoogleAppKeys();
  const redirect_uri = `${WEBAPP_URL_FOR_OAUTH}/api/integrations/googlecalendar/callback`;
  const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uri);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_CALENDAR_SCOPES,
    // A refresh token is only returned the first time the user
    // consents to providing access.  For illustration purposes,
    // setting the prompt to 'consent' will force this consent
    // every time, forcing a refresh_token to be returned.
    prompt: "consent",
    state: encodeOAuthState(req),
  });

  res.status(200).json({ url: authUrl });
}

/**
 * Flowko U9: the 503 both Google Calendar connect routes answer when a token can't be stored encrypted. The
 * connect buttons show the add route's error message as it is (a toast), so the message is in the user's UI
 * language, resolved the way the pages resolve it (getLocale).
 */
export async function calendarConnectionsUnavailableError(req: NextApiRequest): Promise<HttpError> {
  let message = "Calendar connections are unavailable right now. Please try again later.";
  try {
    const t = await getTranslation(await getLocale(req), "common");
    message = t("google_calendar_connections_unavailable");
  } catch {
    // Keep the English message: a translation problem must not turn this answer into a different error
  }
  return new HttpError({ statusCode: 503, message });
}

export default defaultHandler({
  GET: Promise.resolve({ default: defaultResponder(getHandler) }),
});
