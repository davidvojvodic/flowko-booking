import { createHmac } from "node:crypto";

import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GOOGLE_CALENDAR_SCOPES, WEBAPP_URL } from "@calcom/lib/constants";

import { encodeOAuthState } from "../../_utils/oauth/encodeOAuthState";

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  credentialCreate: vi.fn(),
  findFirstByUserIdAndType: vi.fn(),
  deleteById: vi.fn(),
  getPrimaryCalendar: vi.fn(),
  upsertSelectedCalendar: vi.fn(),
  listCalendars: vi.fn(),
  appFindUnique: vi.fn(),
  revokeUnstoredGoogleCalendarToken: vi.fn(),
  findEarlierGoogleCalendarCredentials: vi.fn(),
  replaceEarlierGoogleCalendarCredentials: vi.fn(),
  buildCredentialCreateData: vi.fn(),
  isCredentialKeyringConfigured: vi.fn(),
}));

vi.mock("googleapis-common", () => ({
  OAuth2Client: vi.fn().mockImplementation(function () {
    return { getToken: mocks.getToken, setCredentials: vi.fn() };
  }),
}));

vi.mock("@googleapis/calendar", () => ({
  calendar_v3: { Calendar: vi.fn() },
}));

vi.mock("@calcom/app-store/googlecalendar/lib/CalendarService", () => ({
  createGoogleCalendarServiceWithGoogleType: vi.fn(() => ({
    getPrimaryCalendar: mocks.getPrimaryCalendar,
    upsertSelectedCalendar: mocks.upsertSelectedCalendar,
    listCalendars: mocks.listCalendars,
  })),
}));

vi.mock("@calcom/features/credentials/handleDeleteCredential", () => ({
  revokeUnstoredGoogleCalendarToken: mocks.revokeUnstoredGoogleCalendarToken,
}));

vi.mock("@calcom/features/credentials/repositories/CredentialRepository", () => ({
  CredentialRepository: {
    create: mocks.credentialCreate,
    findFirstByUserIdAndType: mocks.findFirstByUserIdAndType,
    deleteById: mocks.deleteById,
  },
}));

vi.mock("@calcom/features/credentials/services/CredentialDataService", () => ({
  buildCredentialCreateData: mocks.buildCredentialCreateData,
  isCredentialKeyringConfigured: mocks.isCredentialKeyringConfigured,
}));

vi.mock("@calcom/lib/connectedCalendar", () => ({
  renewSelectedCalendarCredentialId: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({
  default: { app: { findUnique: mocks.appFindUnique } },
  prisma: { app: { findUnique: mocks.appFindUnique } },
}));

vi.mock("../lib/getGoogleAppKeys", () => ({
  getGoogleAppKeys: vi.fn().mockResolvedValue({ client_id: "client-id", client_secret: "client-secret" }),
}));

vi.mock("../lib/replaceEarlierCredentials", () => ({
  findEarlierGoogleCalendarCredentials: mocks.findEarlierGoogleCalendarCredentials,
  replaceEarlierGoogleCalendarCredentials: mocks.replaceEarlierGoogleCalendarCredentials,
}));

const SECRET = "test-nextauth-secret";
const VICTIM_ID = 1;
const ATTACKER_ID = 2;

function signedState(userId: number, state: Record<string, unknown> = {}) {
  const nonce = "attacker-or-victim-nonce";
  return JSON.stringify({
    ...state,
    nonce,
    nonceHash: createHmac("sha256", SECRET).update(`${nonce}:${userId}`).digest("hex"),
  });
}

// The state the connect button produces for this user, through the add route's encodeOAuthState
function stateFromAdd(userId: number, state: Record<string, unknown>) {
  const { req } = createMocks<NextApiRequest, NextApiResponse>({
    method: "GET",
    query: { state: JSON.stringify(state) },
  });
  req.session = { user: { id: userId } } as NextApiRequest["session"];
  return encodeOAuthState(req);
}

async function callCallback({
  userId,
  query,
  headers = {},
}: {
  userId?: number;
  query: Record<string, string>;
  headers?: Record<string, string>;
}) {
  const { default: handler } = await import("./callback");
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: "GET", query, headers });
  if (userId) req.session = { user: { id: userId } } as NextApiRequest["session"];
  await handler(req, res);
  return res as unknown as NextApiResponse & {
    _getStatusCode: () => number;
    _getJSONData: () => { message: string };
    _getRedirectUrl: () => string;
  };
}

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", SECRET);
  mocks.getToken.mockResolvedValue({
    tokens: { access_token: "access", refresh_token: "refresh", scope: GOOGLE_CALENDAR_SCOPES.join(" ") },
  });
  mocks.credentialCreate.mockImplementation(async (data: object) => ({ id: 10, ...data }));
  mocks.findFirstByUserIdAndType.mockResolvedValue(null);
  mocks.getPrimaryCalendar.mockResolvedValue({ id: "owner@example.com" });
  mocks.upsertSelectedCalendar.mockResolvedValue(undefined);
  mocks.findEarlierGoogleCalendarCredentials.mockResolvedValue([]);
  mocks.replaceEarlierGoogleCalendarCredentials.mockResolvedValue(undefined);
  mocks.appFindUnique.mockResolvedValue({ enabled: false });
  mocks.buildCredentialCreateData.mockImplementation((data: unknown) => data);
  mocks.isCredentialKeyringConfigured.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("googlecalendar callback: OAuth state", () => {
  it("refuses a code that arrives without a state, before redeeming it", async () => {
    const res = await callCallback({ userId: VICTIM_ID, query: { code: "attacker-code" } });

    expect(res._getStatusCode()).toBe(403);
    expect(res._getJSONData().message).toBe("Invalid OAuth state");
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.credentialCreate).not.toHaveBeenCalled();
  });

  it("refuses a state without a nonce, before redeeming the code", async () => {
    const res = await callCallback({
      userId: VICTIM_ID,
      query: { code: "attacker-code", state: JSON.stringify({ fromApp: true, returnTo: "/apps" }) },
    });

    expect(res._getStatusCode()).toBe(403);
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.credentialCreate).not.toHaveBeenCalled();
  });

  it("refuses a state whose nonce hash is forged, before redeeming the code", async () => {
    const res = await callCallback({
      userId: VICTIM_ID,
      query: {
        code: "attacker-code",
        state: JSON.stringify({ nonce: "n", nonceHash: "00".repeat(32) }),
      },
    });

    expect(res._getStatusCode()).toBe(403);
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("refuses a state signed for another user, before redeeming the code", async () => {
    const res = await callCallback({
      userId: VICTIM_ID,
      query: { code: "attacker-code", state: signedState(ATTACKER_ID, { fromApp: true }) },
    });

    expect(res._getStatusCode()).toBe(403);
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.credentialCreate).not.toHaveBeenCalled();
  });

  it("still answers 401 to a signed-out request, before redeeming the code", async () => {
    const res = await callCallback({ query: { code: "attacker-code" } });

    expect(res._getStatusCode()).toBe(401);
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("still redirects a denied consent (no code) to the state's error page", async () => {
    const state = stateFromAdd(VICTIM_ID, {
      fromApp: true,
      onErrorReturnTo: `${WEBAPP_URL}/apps/google-calendar`,
    });

    const res = await callCallback({
      userId: VICTIM_ID,
      query: { error: "access_denied", state: state as string },
    });

    expect(res._getRedirectUrl()).toBe(`${WEBAPP_URL}/apps/google-calendar`);
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("connects the calendar for the user who started the flow", async () => {
    const state = stateFromAdd(VICTIM_ID, { fromApp: true, onErrorReturnTo: `${WEBAPP_URL}/apps/installed` });

    const res = await callCallback({
      userId: VICTIM_ID,
      query: { code: "own-code", state: state as string },
    });

    expect(mocks.getToken).toHaveBeenCalledWith("own-code");
    expect(mocks.credentialCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: VICTIM_ID, appId: "google-calendar", type: "google_calendar" })
    );
    expect(mocks.upsertSelectedCalendar).toHaveBeenCalledWith({
      eventTypeId: null,
      externalId: "owner@example.com",
    });
    expect(res._getRedirectUrl()).toContain("/apps/installed/calendar?hl=google-calendar");
  });
});

describe("googlecalendar callback: Google Meet install", () => {
  function connectWithMeet() {
    const state = stateFromAdd(VICTIM_ID, {
      fromApp: true,
      onErrorReturnTo: `${WEBAPP_URL}/apps/installed`,
      installGoogleVideo: true,
    });
    return callCallback({ userId: VICTIM_ID, query: { code: "own-code", state } });
  }

  it("creates no Meet credential while the admin has Google Meet switched off", async () => {
    mocks.appFindUnique.mockResolvedValue({ enabled: false });

    const res = await connectWithMeet();

    expect(mocks.appFindUnique).toHaveBeenCalledWith({
      where: { slug: "google-meet" },
      select: { enabled: true },
    });
    expect(mocks.credentialCreate).toHaveBeenCalledTimes(1);
    expect(mocks.credentialCreate).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "google-calendar" })
    );
    expect(mocks.credentialCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ appId: "google-meet" })
    );
    expect(res._getRedirectUrl()).toContain("/apps/installed/calendar?hl=google-calendar");
  });

  it("creates no Meet credential when Google Meet has no App row", async () => {
    mocks.appFindUnique.mockResolvedValue(null);

    await connectWithMeet();

    expect(mocks.credentialCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ appId: "google-meet" })
    );
  });

  it("creates no Meet credential through an empty code either", async () => {
    mocks.appFindUnique.mockResolvedValue({ enabled: false });
    const state = stateFromAdd(VICTIM_ID, { fromApp: true, installGoogleVideo: true });

    await callCallback({ userId: VICTIM_ID, query: { code: "", state } });

    expect(mocks.credentialCreate).not.toHaveBeenCalled();
  });

  it("installs Google Meet with the calendar once the admin switches it on", async () => {
    mocks.appFindUnique.mockResolvedValue({ enabled: true });

    const res = await connectWithMeet();

    expect(mocks.credentialCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: VICTIM_ID, appId: "google-meet", type: "google_video" })
    );
    expect(res._getRedirectUrl()).toContain("/apps/installed/conferencing?hl=google-meet");
  });
});

describe("googlecalendar callback: credential keyring", () => {
  const UNAVAILABLE = "Calendar connections are unavailable right now. Please try again later.";
  const BACK_WITH_REASON = `${WEBAPP_URL}/apps/installed?error=google_calendar_connections_unavailable`;
  const freshTokens = {
    access_token: "ya29.fresh-access-token",
    refresh_token: "1//fresh-refresh-token",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
  };

  function connect(
    headers: Record<string, string> = {},
    state: Record<string, unknown> = { fromApp: true, onErrorReturnTo: `${WEBAPP_URL}/apps/installed` }
  ) {
    return callCallback({
      userId: VICTIM_ID,
      query: { code: "own-code", state: stateFromAdd(VICTIM_ID, state) as string },
      headers,
    });
  }

  // A flow that did not start in the app: no page to go back to
  const NOT_FROM_APP = { fromApp: false };

  beforeEach(() => {
    mocks.getToken.mockResolvedValue({ tokens: freshTokens });
  });

  it("sends the host back with the reason, before redeeming the code, when the credential keyring is not configured", async () => {
    mocks.isCredentialKeyringConfigured.mockReturnValue(false);

    const res = await connect();

    expect(res._getRedirectUrl()).toBe(BACK_WITH_REASON);
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.buildCredentialCreateData).not.toHaveBeenCalled();
    expect(mocks.credentialCreate).not.toHaveBeenCalled();
    expect(mocks.revokeUnstoredGoogleCalendarToken).not.toHaveBeenCalled();
  });

  it("still checks the OAuth state first, so a forged callback learns nothing about the keyring", async () => {
    mocks.isCredentialKeyringConfigured.mockReturnValue(false);

    const res = await callCallback({ userId: VICTIM_ID, query: { code: "attacker-code" } });

    expect(res._getStatusCode()).toBe(403);
  });

  it("revokes the fresh token, stores nothing and sends the host back when its key can't be encrypted", async () => {
    mocks.buildCredentialCreateData.mockImplementation(() => {
      throw new Error(
        "Credential key unavailable (keyring_not_configured) for credential new (google_calendar)"
      );
    });

    const res = await connect();

    expect(res._getRedirectUrl()).toBe(BACK_WITH_REASON);
    expect(mocks.credentialCreate).not.toHaveBeenCalled();
    expect(mocks.revokeUnstoredGoogleCalendarToken).toHaveBeenCalledWith({
      userId: VICTIM_ID,
      key: freshTokens,
    });
    expect(mocks.upsertSelectedCalendar).not.toHaveBeenCalled();
    expect(mocks.replaceEarlierGoogleCalendarCredentials).not.toHaveBeenCalled();
    // The answer carries no token and no detail of the failure
    expect(res._getRedirectUrl()).not.toContain("fresh-");
    expect(res._getRedirectUrl()).not.toContain("keyring_not_configured");
  });

  it("keeps the 503 JSON, without details, for a flow that has no page in the app to go back to", async () => {
    mocks.buildCredentialCreateData.mockImplementation(() => {
      throw new Error(
        "Credential key unavailable (keyring_not_configured) for credential new (google_calendar)"
      );
    });

    const res = await connect({}, NOT_FROM_APP);

    expect(res._getStatusCode()).toBe(503);
    expect(res._getJSONData().message).toBe(UNAVAILABLE);
    expect(mocks.revokeUnstoredGoogleCalendarToken).toHaveBeenCalledWith({
      userId: VICTIM_ID,
      key: freshTokens,
    });
    const body = JSON.stringify(res._getJSONData());
    expect(body).not.toContain("fresh-");
    expect(body).not.toContain("keyring_not_configured");
  });

  it("sends the host back to the installed calendars when the state has no page of its own", async () => {
    mocks.isCredentialKeyringConfigured.mockReturnValue(false);

    const res = await connect({}, { fromApp: true });

    const url = new URL(res._getRedirectUrl());
    expect(`${url.origin}${url.pathname}`).toBe(`${WEBAPP_URL}/apps/installed/calendar`);
    expect(url.searchParams.get("hl")).toBe("google-calendar");
    expect(url.searchParams.get("error")).toBe("google_calendar_connections_unavailable");
  });

  it.each([
    ["a relative page", "/apps/installed", `${WEBAPP_URL}/apps/installed/calendar`],
    ["a page on another site", "https://attacker.example/phish", `${WEBAPP_URL}/`],
  ])("never sends the host to %s", async (_label, onErrorReturnTo, expectedPage) => {
    mocks.isCredentialKeyringConfigured.mockReturnValue(false);

    const res = await connect({}, { fromApp: true, onErrorReturnTo });

    const url = new URL(res._getRedirectUrl());
    expect(`${url.origin}${url.pathname}`).toBe(expectedPage);
    expect(url.searchParams.get("error")).toBe("google_calendar_connections_unavailable");
  });

  it("revokes the fresh token when the credential row can't be created", async () => {
    mocks.credentialCreate.mockRejectedValue(new Error("new row violates check constraint"));

    const res = await connect();

    expect(res._getRedirectUrl()).toBe(BACK_WITH_REASON);
    expect(mocks.revokeUnstoredGoogleCalendarToken).toHaveBeenCalledWith({
      userId: VICTIM_ID,
      key: freshTokens,
    });
    expect(mocks.upsertSelectedCalendar).not.toHaveBeenCalled();
    expect(res._getRedirectUrl()).not.toContain("check constraint");
  });

  it("tells a Slovenian user in Slovenian when it answers with JSON", async () => {
    mocks.isCredentialKeyringConfigured.mockReturnValue(false);

    const res = await connect({ "accept-language": "sl" }, NOT_FROM_APP);

    expect(res._getStatusCode()).toBe(503);
    expect(res._getJSONData().message).toBe(
      "Povezovanje koledarjev trenutno ni na voljo. Poskusite znova pozneje."
    );
  });

  it("stores the encrypted credential data it was given and revokes nothing on success", async () => {
    const res = await connect();

    expect(mocks.buildCredentialCreateData).toHaveBeenCalledWith(
      expect.objectContaining({ userId: VICTIM_ID, key: freshTokens, type: "google_calendar" })
    );
    expect(mocks.credentialCreate).toHaveBeenCalledTimes(1);
    expect(mocks.revokeUnstoredGoogleCalendarToken).not.toHaveBeenCalled();
    expect(res._getRedirectUrl()).toContain("/apps/installed/calendar?hl=google-calendar");
  });
});
