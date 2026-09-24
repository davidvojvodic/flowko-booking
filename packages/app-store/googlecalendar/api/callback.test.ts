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
  buildCredentialCreateData: vi.fn((data: unknown) => data),
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

async function callCallback({ userId, query }: { userId?: number; query: Record<string, string> }) {
  const { default: handler } = await import("./callback");
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: "GET", query });
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
