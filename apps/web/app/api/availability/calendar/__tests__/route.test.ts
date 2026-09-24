import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUserWithCredentials: vi.fn(),
  getConnectedCalendars: vi.fn(),
  getCalendarCredentials: vi.fn(),
  upsert: vi.fn(),
  deleteSelectedCalendar: vi.fn(),
  eventTypeFindFirst: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));

vi.mock("@lib/buildLegacyCtx", () => ({
  buildLegacyRequest: vi.fn().mockReturnValue({}),
}));

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: class {
    findUserWithCredentials = mocks.findUserWithCredentials;
  },
}));

vi.mock("@calcom/features/calendars/lib/CalendarManager", () => ({
  getCalendarCredentials: mocks.getCalendarCredentials,
  getConnectedCalendars: mocks.getConnectedCalendars,
}));

vi.mock("@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository", () => ({
  SelectedCalendarRepository: {
    upsert: mocks.upsert,
    delete: mocks.deleteSelectedCalendar,
    findMany: vi.fn(),
  },
}));

vi.mock("@calcom/prisma", () => {
  const prisma = { eventType: { findFirst: mocks.eventTypeFindFirst } };
  return { default: prisma, prisma };
});

import { DELETE, POST } from "../route";

const OWN_CREDENTIAL = { id: 11, type: "google_calendar", userId: 1 };
const OWN_EVENT_TYPE_ID = 21;

const context = { params: Promise.resolve({}) };

const post = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/availability/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    context
  );

const del = (params: Record<string, string>) => {
  const url = new URL("http://localhost/api/availability/calendar");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const req = new Request(url, { method: "DELETE" }) as unknown as NextRequest;
  Object.assign(req, { nextUrl: url });
  return DELETE(req, context);
};

describe("/api/availability/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: 1 } });
    mocks.findUserWithCredentials.mockResolvedValue({
      id: 1,
      credentials: [OWN_CREDENTIAL],
      userLevelSelectedCalendars: [],
    });
    mocks.getCalendarCredentials.mockImplementation((credentials: unknown[]) =>
      credentials.map((credential) => ({ credential }))
    );
    mocks.getConnectedCalendars.mockResolvedValue({
      connectedCalendars: [
        {
          credentialId: OWN_CREDENTIAL.id,
          calendars: [
            { externalId: "owner@gmail.com", credentialId: OWN_CREDENTIAL.id, primary: true },
            { externalId: "team-shared@group.calendar.google.com", credentialId: OWN_CREDENTIAL.id },
          ],
        },
      ],
      destinationCalendar: undefined,
    });
    mocks.eventTypeFindFirst.mockImplementation(({ where }: { where: { id: number; userId: number } }) =>
      Promise.resolve(where.id === OWN_EVENT_TYPE_ID && where.userId === 1 ? { id: where.id } : null)
    );
  });

  describe("POST", () => {
    it("saves a calendar that the caller's own credential lists", async () => {
      const res = await post({
        integration: "google_calendar",
        externalId: "team-shared@group.calendar.google.com",
        credentialId: String(OWN_CREDENTIAL.id),
      });

      expect(res.status).toBe(200);
      expect(mocks.getCalendarCredentials).toHaveBeenCalledWith([OWN_CREDENTIAL]);
      expect(mocks.upsert).toHaveBeenCalledWith({
        userId: 1,
        integration: "google_calendar",
        externalId: "team-shared@group.calendar.google.com",
        credentialId: OWN_CREDENTIAL.id,
        delegationCredentialId: null,
        eventTypeId: null,
      });
    });

    it("saves an event-type calendar for the caller's own event type", async () => {
      const res = await post({
        integration: "google_calendar",
        externalId: "owner@gmail.com",
        credentialId: String(OWN_CREDENTIAL.id),
        eventTypeId: String(OWN_EVENT_TYPE_ID),
      });

      expect(res.status).toBe(200);
      expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ eventTypeId: OWN_EVENT_TYPE_ID }));
    });

    it("refuses another tenant's calendar id that the credential does not list", async () => {
      const res = await post({
        integration: "google_calendar",
        externalId: "victim-salon@gmail.com",
        credentialId: String(OWN_CREDENTIAL.id),
      });

      expect(res.status).toBe(403);
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it("refuses when Google cannot list the credential's calendars", async () => {
      mocks.getConnectedCalendars.mockResolvedValue({
        connectedCalendars: [{ credentialId: OWN_CREDENTIAL.id, error: { message: "Could not get" } }],
        destinationCalendar: undefined,
      });

      const res = await post({
        integration: "google_calendar",
        externalId: "owner@gmail.com",
        credentialId: String(OWN_CREDENTIAL.id),
      });

      expect(res.status).toBe(403);
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it("refuses another tenant's credential without asking Google", async () => {
      const res = await post({
        integration: "google_calendar",
        externalId: "owner@gmail.com",
        credentialId: "99",
      });

      expect(res.status).toBe(403);
      expect(mocks.getConnectedCalendars).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it("refuses the caller's credential under another integration", async () => {
      const res = await post({
        integration: "office365_calendar",
        externalId: "owner@gmail.com",
        credentialId: String(OWN_CREDENTIAL.id),
      });

      expect(res.status).toBe(403);
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it("refuses a delegation credential id", async () => {
      const res = await post({
        integration: "google_calendar",
        externalId: "owner@gmail.com",
        credentialId: String(OWN_CREDENTIAL.id),
        delegationCredentialId: "dc-1",
      });

      expect(res.status).toBe(403);
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it("refuses another tenant's event type", async () => {
      const res = await post({
        integration: "google_calendar",
        externalId: "owner@gmail.com",
        credentialId: String(OWN_CREDENTIAL.id),
        eventTypeId: "77",
      });

      expect(res.status).toBe(403);
      expect(mocks.eventTypeFindFirst).toHaveBeenCalledWith({
        where: { id: 77, userId: 1 },
        select: { id: true },
      });
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it("answers 401 without a session", async () => {
      mocks.getServerSession.mockResolvedValue(null);

      const res = await post({
        integration: "google_calendar",
        externalId: "owner@gmail.com",
        credentialId: String(OWN_CREDENTIAL.id),
      });

      expect(res.status).toBe(401);
      expect(mocks.upsert).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    it("unselects the caller's calendar without asking Google", async () => {
      const res = await del({
        integration: "google_calendar",
        externalId: "no-longer-listed@gmail.com",
        credentialId: String(OWN_CREDENTIAL.id),
        eventTypeId: String(OWN_EVENT_TYPE_ID),
      });

      expect(res.status).toBe(200);
      expect(mocks.getConnectedCalendars).not.toHaveBeenCalled();
      expect(mocks.deleteSelectedCalendar).toHaveBeenCalledWith({
        where: {
          userId: 1,
          externalId: "no-longer-listed@gmail.com",
          integration: "google_calendar",
          eventTypeId: OWN_EVENT_TYPE_ID,
        },
      });
    });

    it("refuses another tenant's credential", async () => {
      const res = await del({
        integration: "google_calendar",
        externalId: "owner@gmail.com",
        credentialId: "99",
      });

      expect(res.status).toBe(403);
      expect(mocks.deleteSelectedCalendar).not.toHaveBeenCalled();
    });

    it("refuses another tenant's event type", async () => {
      const res = await del({
        integration: "google_calendar",
        externalId: "owner@gmail.com",
        credentialId: String(OWN_CREDENTIAL.id),
        eventTypeId: "77",
      });

      expect(res.status).toBe(403);
      expect(mocks.deleteSelectedCalendar).not.toHaveBeenCalled();
    });
  });
});
