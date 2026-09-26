/**
 * Flowko (U9 F-DEST): a calendar-list error for a connection (a key failure such as a keyring outage or the
 * planned key drill, an expired grant, any listCalendars failure) must never rewrite the host's destination
 * calendar. Upstream copied connectedCalendars[0].primary over it, which for an errored entry is
 * integration "" / externalId "", so the host's chosen calendar was lost for good. The default and repair
 * writes still run for a healthy connection.
 */
import { prisma } from "@calcom/prisma/__mocks__/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@calcom/prisma";
import type { DestinationCalendar } from "@calcom/prisma/client";

const mocks = vi.hoisted(() => ({
  getConnectedCalendars: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({
  default: prisma,
  prisma,
}));

vi.mock("@calcom/app-store/delegationCredential", () => ({
  enrichUserWithDelegationCredentialsIncludeServiceAccountKey: vi.fn(
    async ({ user }: { user: { credentials: unknown[] } }) => ({ credentials: user.credentials })
  ),
}));

vi.mock("@calcom/features/calendars/lib/CalendarManager", () => ({
  getCalendarCredentials: vi.fn(() => []),
  getConnectedCalendars: mocks.getConnectedCalendars,
  cleanIntegrationKeys: vi.fn((integration: unknown) => integration),
}));

import {
  getConnectedDestinationCalendarsAndEnsureDefaultsInDb,
  type UserWithCalendars,
} from "./getConnectedDestinationCalendars";

const USER_ID = 42;
const OWNER = "owner@gmail.com";
const SHOP = "shop@gmail.com";
const SECONDARY = "c_secondary@group.calendar.google.com";
const KEY_ERROR = { message: "Could not get connected calendars" };

const googleIntegration = { slug: "google-calendar", type: "google_calendar", title: "Google Calendar" };

const calendar = (externalId: string, credentialId: number, primary: boolean) => ({
  externalId,
  integration: "google_calendar",
  name: externalId,
  email: primary ? externalId : undefined,
  primary,
  readOnly: false,
  isSelected: false,
  credentialId,
  delegationCredentialId: null,
});

const healthyEntry = (credentialId: number, primaryEmail: string, others: string[] = []) => {
  const primary = calendar(primaryEmail, credentialId, true);
  return {
    integration: googleIntegration,
    credentialId,
    delegationCredentialId: null,
    primary,
    calendars: [primary, ...others.map((externalId) => calendar(externalId, credentialId, false))],
  };
};

const erroredEntry = (credentialId: number) => ({
  integration: googleIntegration,
  credentialId,
  delegationCredentialId: null,
  error: KEY_ERROR,
});

const destination = (overrides: Partial<DestinationCalendar> = {}) =>
  ({
    id: 7,
    userId: USER_ID,
    eventTypeId: null,
    bookingId: null,
    integration: "google_calendar",
    externalId: SECONDARY,
    primaryEmail: OWNER,
    credentialId: 11,
    delegationCredentialId: null,
    ...overrides,
  }) as DestinationCalendar;

const user = (destinationCalendar: DestinationCalendar | null): UserWithCalendars => ({
  id: USER_ID,
  email: OWNER,
  allSelectedCalendars: [],
  userLevelSelectedCalendars: [],
  destinationCalendar,
});

const run = ({
  destinationCalendar,
  connectedCalendars,
  onboarding = false,
  eventTypeId = null,
}: {
  destinationCalendar: DestinationCalendar | null;
  connectedCalendars: unknown[];
  onboarding?: boolean;
  eventTypeId?: number | null;
}) => {
  mocks.getConnectedCalendars.mockResolvedValue({ connectedCalendars, destinationCalendar: undefined });
  return getConnectedDestinationCalendarsAndEnsureDefaultsInDb({
    user: user(destinationCalendar),
    onboarding,
    eventTypeId,
    prisma: prisma as unknown as PrismaClient,
  });
};

const expectNoDestinationOrSelectedCalendarWrite = () => {
  expect(prisma.destinationCalendar.update).not.toHaveBeenCalled();
  expect(prisma.destinationCalendar.updateMany).not.toHaveBeenCalled();
  expect(prisma.destinationCalendar.upsert).not.toHaveBeenCalled();
  expect(prisma.destinationCalendar.create).not.toHaveBeenCalled();
  expect(prisma.destinationCalendar.delete).not.toHaveBeenCalled();
  expect(prisma.selectedCalendar.create).not.toHaveBeenCalled();
  expect(prisma.selectedCalendar.upsert).not.toHaveBeenCalled();
};

describe("getConnectedDestinationCalendarsAndEnsureDefaultsInDb (Flowko: an errored entry writes nothing)", () => {
  beforeEach(() => {
    mocks.getConnectedCalendars.mockReset();
    prisma.credential.findMany.mockResolvedValue([]);
  });

  describe("the destination's own connection has an error", () => {
    it.each([
      { label: "user-level settings view", eventTypeId: null, onboarding: false },
      { label: "event type Advanced tab", eventTypeId: 99, onboarding: false },
      { label: "onboarding / ensureDefaultCalendars task", eventTypeId: null, onboarding: true },
    ])("leaves the destination unchanged ($label)", async ({ eventTypeId, onboarding }) => {
      const current = destination();

      const result = await run({
        destinationCalendar: current,
        connectedCalendars: [erroredEntry(11)],
        eventTypeId,
        onboarding,
      });

      expectNoDestinationOrSelectedCalendarWrite();
      expect(result.destinationCalendar).toMatchObject({
        integration: "google_calendar",
        externalId: SECONDARY,
        credentialId: 11,
      });
    });

    it("does not re-point it to another, healthy connection's primary", async () => {
      await run({
        destinationCalendar: destination({ credentialId: 11 }),
        connectedCalendars: [healthyEntry(12, SHOP), erroredEntry(11)],
      });

      expectNoDestinationOrSelectedCalendarWrite();
    });

    it("does not touch a legacy destination with no credential when any connection has an error", async () => {
      await run({
        destinationCalendar: destination({ credentialId: null }),
        connectedCalendars: [healthyEntry(12, SHOP), erroredEntry(11)],
      });

      expectNoDestinationOrSelectedCalendarWrite();
    });
  });

  it("does not repair from an errored first entry even when the destination's connection is healthy", async () => {
    // The destination calendar is really gone from credential 12, but the entry the repair copies from
    // (connectedCalendars[0]) has no primary: upstream would store integration "" and externalId "".
    await run({
      destinationCalendar: destination({ credentialId: 12 }),
      connectedCalendars: [erroredEntry(11), healthyEntry(12, SHOP)],
    });

    expectNoDestinationOrSelectedCalendarWrite();
  });

  it("repairs a destination calendar that disappeared from a healthy connection, as upstream does", async () => {
    const repaired = destination({ externalId: OWNER, primaryEmail: OWNER });
    prisma.destinationCalendar.update.mockResolvedValue(repaired);

    const result = await run({
      destinationCalendar: destination(),
      connectedCalendars: [healthyEntry(11, OWNER, ["c_other@group.calendar.google.com"])],
    });

    expect(prisma.destinationCalendar.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { integration: "google_calendar", externalId: OWNER, primaryEmail: OWNER },
    });
    expect(result.destinationCalendar).toMatchObject({ externalId: OWNER });
  });

  it("repairs when the destination's credential is gone and the remaining connection is healthy", async () => {
    prisma.destinationCalendar.update.mockResolvedValue(destination({ externalId: SHOP, credentialId: 12 }));

    await run({
      destinationCalendar: destination({ credentialId: 11 }),
      connectedCalendars: [healthyEntry(12, SHOP)],
    });

    expect(prisma.destinationCalendar.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { integration: "google_calendar", externalId: SHOP, primaryEmail: SHOP },
    });
  });

  it("does not write when the destination is present in a healthy connection", async () => {
    await run({
      destinationCalendar: destination(),
      connectedCalendars: [healthyEntry(11, OWNER, [SECONDARY]), erroredEntry(12)],
    });

    expectNoDestinationOrSelectedCalendarWrite();
  });

  it("sets the first connection's primary as the default when there is no destination yet", async () => {
    prisma.destinationCalendar.create.mockResolvedValue(destination({ externalId: OWNER }));

    const result = await run({
      destinationCalendar: null,
      connectedCalendars: [healthyEntry(11, OWNER, [SECONDARY])],
    });

    expect(prisma.destinationCalendar.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        integration: "google_calendar",
        externalId: OWNER,
        primaryEmail: OWNER,
        credentialId: 11,
      },
    });
    expect(result.destinationCalendar).toMatchObject({ externalId: OWNER });
  });

  it("sets the default and selects it on onboarding when there is no destination yet", async () => {
    prisma.destinationCalendar.create.mockResolvedValue(destination({ externalId: OWNER }));

    await run({
      destinationCalendar: null,
      connectedCalendars: [healthyEntry(11, OWNER)],
      onboarding: true,
    });

    expect(prisma.destinationCalendar.create).toHaveBeenCalledTimes(1);
    expect(prisma.selectedCalendar.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, integration: "google_calendar", externalId: OWNER, eventTypeId: null },
    });
  });

  it.each([
    { label: "only errored connections", connectedCalendars: [erroredEntry(11)] },
    { label: "an errored first connection", connectedCalendars: [erroredEntry(11), healthyEntry(12, SHOP)] },
  ])("does not create a default destination from $label", async ({ connectedCalendars }) => {
    const result = await run({ destinationCalendar: null, connectedCalendars, onboarding: true });

    expectNoDestinationOrSelectedCalendarWrite();
    expect(result.destinationCalendar).not.toHaveProperty("externalId");
  });
});
