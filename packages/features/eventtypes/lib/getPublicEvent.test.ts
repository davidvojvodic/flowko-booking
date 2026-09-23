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
