/**
 * Flowko (B1): editLocation hands the organizer's new location to EventManager.updateLocation, which runs the
 * location's app (a Meet link on the host's Google calendar, a Cal Video room). A switched-off app
 * (App.enabled = false) is now refused there too; every other location still goes through.
 */
import { ErrorCode } from "@calcom/lib/errorCodes";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appFindMany, updateLocation, updateLocationById, sendLocationChangeEmailsAndSMS, organizer } =
  vi.hoisted(() => ({
    appFindMany: vi.fn(),
    updateLocation: vi.fn(),
    updateLocationById: vi.fn(),
    sendLocationChangeEmailsAndSMS: vi.fn(),
    organizer: { metadata: null as Record<string, unknown> | null },
  }));

vi.mock("@calcom/prisma", () => ({ prisma: { app: { findMany: appFindMany } }, default: {} }));
vi.mock("@calcom/features/bookings/lib/EventManager", () => ({
  default: vi.fn(function EventManager() {
    return { updateLocation };
  }),
}));
vi.mock("@calcom/features/bookings/repositories/BookingRepository", () => ({
  BookingRepository: vi.fn(function BookingRepository() {
    return { updateLocationById };
  }),
}));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: vi.fn(function UserRepository() {
    return {
      findByIdOrThrow: vi.fn(async () => ({ id: 101, name: "Organizer", metadata: organizer.metadata })),
    };
  }),
}));
vi.mock("@calcom/app-store/delegationCredential", () => ({
  getUsersCredentialsIncludeServiceAccountKey: vi.fn(async () => []),
}));
vi.mock("@calcom/lib/buildCalEventFromBooking", () => ({
  buildCalEventFromBooking: vi.fn(async ({ location }: { location: string }) => ({ location })),
}));
vi.mock("@calcom/emails/email-manager", () => ({ sendLocationChangeEmailsAndSMS }));
vi.mock("@calcom/i18n/server", () => ({
  getTranslation: vi.fn(async (locale: string) => (key: string) => `${locale}:${key}`),
}));

import { editLocationHandler } from "./editLocation.handler";
import { ZEditLocationInputSchema } from "./editLocation.schema";

// An App table in which only the given apps are enabled
function withEnabledApps(...enabledSlugs: string[]) {
  appFindMany.mockImplementation(
    async ({ where }: { where: { OR: [unknown, { slug: { in: string[] } }] } }) =>
      where.OR[1].slug.in
        .filter((slug) => enabledSlugs.includes(slug))
        .map((slug) => ({ slug, dirName: slug }))
  );
}

// The input goes through the procedure's schema first, as the tRPC router parses it
const editLocation = (newLocation: string) =>
  editLocationHandler({
    ctx: {
      user: { id: 101, email: "organizer@example.com", locale: "en" },
      booking: { id: 1, userId: 101, location: "inPerson", metadata: {}, responses: {}, references: [] },
    } as unknown as Parameters<typeof editLocationHandler>[0]["ctx"],
    input: ZEditLocationInputSchema.parse({ bookingId: 1, newLocation, credentialId: null }),
    actionSource: "WEBAPP",
  });

async function expectRefusedAndNothingRun(newLocation: string) {
  await expect(editLocation(newLocation)).rejects.toMatchObject({
    code: "BAD_REQUEST",
    // Translated in the organizer's language: the dialog shows the message as sent
    message: `en:${ErrorCode.AppNotAvailable}`,
  });
  expect(updateLocation).not.toHaveBeenCalled();
  expect(updateLocationById).not.toHaveBeenCalled();
  expect(sendLocationChangeEmailsAndSMS).not.toHaveBeenCalled();
}

describe("editLocationHandler with a switched-off app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizer.metadata = null;
    updateLocation.mockResolvedValue({ results: [], referencesToCreate: [] });
  });

  it.each([
    "integrations:google:meet",
    "integrations:daily",
    "integrations:zoom",
  ])("refuses %s while its app is switched off, and runs nothing", async (newLocation) => {
    withEnabledApps("google-calendar");

    await expectRefusedAndNothingRun(newLocation);
  });

  it("refuses an empty location, which the schema reads as Cal Video, while Cal Video is switched off", async () => {
    withEnabledApps("google-calendar");

    await expectRefusedAndNothingRun("");
  });

  it("moves the booking to Cal Video for an empty location while Cal Video is enabled", async () => {
    withEnabledApps("google-calendar", "daily-video");

    await expect(editLocation("")).resolves.toEqual({ message: "Location updated" });
    expect(updateLocation).toHaveBeenCalledWith(
      expect.objectContaining({ location: "integrations:daily" }),
      expect.anything()
    );
  });

  it.each([
    ["google-meet", undefined],
    ["daily-video", undefined],
    // A static-link app resolves to the organizer's saved link, a URL no app claims
    ["facetime", "https://facetime.apple.com/join#v=1&p=abc"],
  ])(
    "refuses the organizer's default app (%s) while it is switched off",
    async (appSlug, appLink) => {
      organizer.metadata = { defaultConferencingApp: { appSlug, appLink } };
      withEnabledApps("google-calendar");

      await expectRefusedAndNothingRun("conferencing");
    }
  );

  it.each([
    ["google-meet", undefined, "integrations:google:meet"],
    ["facetime", "https://facetime.apple.com/join#v=1&p=abc", "https://facetime.apple.com/join#v=1&p=abc"],
  ])(
    "moves the booking to the organizer's default app (%s) while it is enabled",
    async (appSlug, appLink, expectedLocation) => {
      organizer.metadata = { defaultConferencingApp: { appSlug, appLink } };
      withEnabledApps("google-calendar", appSlug);

      await expect(editLocation("conferencing")).resolves.toEqual({ message: "Location updated" });
      expect(updateLocation).toHaveBeenCalledWith(
        expect.objectContaining({ location: expectedLocation }),
        expect.anything()
      );
    }
  );

  it("moves the booking to an app's location while the app is enabled", async () => {
    withEnabledApps("google-calendar", "google-meet");

    await expect(editLocation("integrations:google:meet")).resolves.toEqual({ message: "Location updated" });
    expect(updateLocation).toHaveBeenCalledWith(
      expect.objectContaining({ location: "integrations:google:meet" }),
      expect.anything()
    );
  });

  it("moves the booking to an address or a phone number without asking about apps", async () => {
    withEnabledApps();

    await expect(editLocation("Slovenska 1, Ljubljana")).resolves.toEqual({ message: "Location updated" });
    await expect(editLocation("+38640123456")).resolves.toEqual({ message: "Location updated" });
    expect(appFindMany).not.toHaveBeenCalled();
    expect(updateLocation).toHaveBeenCalledTimes(2);
  });
});
