import "../__mocks__/getGoogleAppKeys";
import { calendarMock, getLastCreatedOAuth2Client, setCredentialsMock } from "../__mocks__/googleapis";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { lookUpGoogleAccount } from "../lookUpGoogleAccount";

const storedKey = {
  access_token: "stored-access-token",
  refresh_token: "stored-refresh-token",
  expiry_date: 1625097600000,
  scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
};

const calendarsGetMock = () =>
  calendarMock.calendar_v3.Calendar().calendars.get as unknown as ReturnType<typeof vi.fn>;

// Shaped like a gaxios error: it keeps the request, with the bearer token, on config
const buildGaxiosError = (message: string, data: unknown) =>
  Object.assign(new Error(message), {
    config: { headers: { Authorization: "Bearer stored-access-token" } },
    response: { status: 400, data },
  });

describe("lookUpGoogleAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns the primary calendar id Google reports for the token", async () => {
    calendarsGetMock().mockResolvedValueOnce({ data: { id: "owner@gmail.com" } });

    const account = await lookUpGoogleAccount(storedKey);

    expect(account).toEqual({ status: "found", primaryCalendarId: "owner@gmail.com" });
    expect(calendarsGetMock()).toHaveBeenCalledWith({ calendarId: "primary", fields: "id" });
    expect(setCredentialsMock).toHaveBeenCalledWith({
      access_token: "stored-access-token",
      refresh_token: "stored-refresh-token",
      expiry_date: 1625097600000,
    });
  });

  test("refreshes on a 401 even though the stored token has an expiry date", async () => {
    // A grant revoked while its access token is still valid answers 401. Only a refresh then makes
    // Google say invalid_grant, and google-auth-library skips that refresh when expiry_date is set
    // unless forceRefreshOnFailure is on.
    calendarsGetMock().mockResolvedValueOnce({ data: { id: "owner@gmail.com" } });

    await lookUpGoogleAccount(storedKey);

    expect(getLastCreatedOAuth2Client()?.args[0]).toMatchObject({ forceRefreshOnFailure: true });
  });

  test("reports a revoked grant when Google refuses the refresh token", async () => {
    calendarsGetMock().mockRejectedValueOnce(
      buildGaxiosError("invalid_grant", {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      })
    );

    expect(await lookUpGoogleAccount(storedKey)).toEqual({ status: "grant_revoked" });
  });

  test("does not know the account when the token lacks calendar.readonly", async () => {
    calendarsGetMock().mockRejectedValueOnce(
      buildGaxiosError("Request had insufficient authentication scopes.", {
        error: { code: 403, status: "PERMISSION_DENIED" },
      })
    );

    expect(await lookUpGoogleAccount(storedKey)).toEqual({ status: "unknown" });
  });

  test("does not call Google for a key without a token", async () => {
    expect(await lookUpGoogleAccount({})).toEqual({ status: "unknown" });
    expect(await lookUpGoogleAccount(null)).toEqual({ status: "unknown" });
    expect(calendarsGetMock()).not.toHaveBeenCalled();
  });

  test("gives up after five seconds", async () => {
    vi.useFakeTimers();
    calendarsGetMock().mockReturnValueOnce(new Promise(() => undefined));

    const lookup = lookUpGoogleAccount(storedKey);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await lookup).toEqual({ status: "unknown" });
  });
});
