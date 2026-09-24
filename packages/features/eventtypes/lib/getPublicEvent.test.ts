import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicEvent } from "./getPublicEvent";

vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: vi.fn(function () {
    return {
      enrichUsersWithTheirProfiles: async (users: object[]) =>
        users.map((user) => ({ ...user, profile: { organization: null } })),
      enrichUserWithItsProfile: async ({ user }: { user: object }) => ({
        ...user,
        profile: { organization: null },
      }),
    };
  }),
}));

const owner = {
  id: 1,
  username: "salon",
  name: "Salon",
  avatarUrl: null,
  weekStart: "Monday",
  brandColor: null,
  darkBrandColor: null,
  theme: null,
  metadata: {},
  organization: null,
  defaultScheduleId: null,
};

const eventType = {
  id: 10,
  title: "Haircut",
  slug: "haircut",
  description: "",
  length: 30,
  locations: [],
  customInputs: [],
  bookingFields: [],
  disableGuests: false,
  recurringEvent: null,
  isInstantEvent: false,
  instantMeetingSchedule: null,
  instantMeetingParameters: [],
  teamId: null,
  team: null,
  parent: null,
  hosts: [],
  owner,
  schedule: { id: 1, timeZone: "Europe/Ljubljana" },
  metadata: {
    apps: {
      googlecalendar: {},
      ga4: { enabled: true, trackingId: "G-TEST" },
      metapixel: { enabled: true, trackingId: "123" },
    },
  },
};

// The booker renders the tags of the apps in metadata.apps; the seed leaves only google-calendar enabled
describe("getPublicEvent with apps the admin switched off", () => {
  beforeEach(() => {
    prismaMock.eventType.findFirst.mockResolvedValue(eventType as never);
    prismaMock.app.findMany.mockResolvedValue([
      { slug: "google-calendar", dirName: "googlecalendar" },
    ] as never);
  });

  it("leaves the disabled apps out of the event's metadata", async () => {
    const event = await getPublicEvent("salon", "haircut", false, null, prismaMock, false);

    expect(event?.metadata?.apps).toEqual({ googlecalendar: {} });
    expect(prismaMock.app.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        OR: [
          { dirName: { in: expect.arrayContaining(["googlecalendar", "ga4", "metapixel"]) } },
          { slug: { in: [] } },
        ],
      },
      select: { slug: true, dirName: true },
    });
  });
});

// The result goes to anonymous callers of viewer.public.event and is SSR'd into every booking page
describe("getPublicEvent owner and host data", () => {
  const weekView = { enabledLayouts: ["week_view", "month_view"], defaultLayout: "week_view" };
  const privateUserMetadata = {
    emailChangeWaitingForVerification: "new-login@salon.si",
    stripeCustomerId: "cus_123",
    defaultConferencingApp: { appSlug: "zoom", appLink: "https://zoom.us/j/1" },
  };
  const ownerWithMetadata = {
    ...owner,
    metadata: { ...privateUserMetadata, defaultBookerLayouts: weekView },
    defaultScheduleId: 7,
  };
  const host = {
    user: {
      ...owner,
      id: 2,
      username: "stylist",
      metadata: { ...privateUserMetadata, defaultBookerLayouts: weekView },
      defaultScheduleId: 8,
    },
  };

  beforeEach(() => {
    prismaMock.app.findMany.mockResolvedValue([] as never);
    prismaMock.schedule.findUnique.mockResolvedValue({ id: 7, timeZone: "Europe/Ljubljana" } as never);
  });

  const expectNoPrivateUserFields = (user: object | null | undefined) => {
    expect(user).toBeTruthy();
    expect(user).not.toHaveProperty("metadata");
    expect(user).not.toHaveProperty("defaultScheduleId");
  };

  it("returns the owner without metadata or defaultScheduleId, and still applies their booker layouts", async () => {
    prismaMock.eventType.findFirst.mockResolvedValue({
      ...eventType,
      metadata: {},
      owner: ownerWithMetadata,
      schedule: null,
    } as never);

    const event = await getPublicEvent("salon", "haircut", false, null, prismaMock, false);

    expectNoPrivateUserFields(event?.owner);
    expect(JSON.stringify(event)).not.toContain("new-login@salon.si");
    expect(JSON.stringify(event)).not.toContain("cus_123");
    expect(event?.profile.bookerLayouts).toEqual(weekView);
    // The owner's default schedule still stands in for a missing event schedule
    expect(prismaMock.schedule.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } })
    );
    expect(event?.schedule).toEqual({ timeZone: "Europe/Ljubljana" });
  });

  it("returns the event's own schedule as its time zone only", async () => {
    prismaMock.eventType.findFirst.mockResolvedValue({ ...eventType, metadata: {} } as never);

    const event = await getPublicEvent("salon", "haircut", false, null, prismaMock, false);

    expect(event?.schedule).toEqual({ timeZone: "Europe/Ljubljana" });
    expect(prismaMock.schedule.findUnique).not.toHaveBeenCalled();
  });

  it("returns the hosts without metadata or defaultScheduleId, and still applies the first host's layouts", async () => {
    prismaMock.eventType.findFirst.mockResolvedValue({
      ...eventType,
      metadata: {},
      owner: ownerWithMetadata,
      hosts: [host],
    } as never);

    const event = await getPublicEvent("salon", "haircut", false, null, prismaMock, false, undefined, true);

    expectNoPrivateUserFields(event?.owner);
    expect(event?.subsetOfHosts).toHaveLength(1);
    expectNoPrivateUserFields(event?.subsetOfHosts[0].user);
    expect(event?.hosts).toHaveLength(1);
    expectNoPrivateUserFields(event?.hosts?.[0].user);
    expect(event?.subsetOfHosts[0].user).toMatchObject({ username: "stylist", name: "Salon" });
    expect(JSON.stringify(event)).not.toContain("new-login@salon.si");
    expect(event?.profile.bookerLayouts).toEqual(weekView);
  });
});
