import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";

import type { TrpcSessionUser } from "../../../types";
import { setDefaultConferencingAppHandler } from "./setDefaultConferencingApp.handler";
import { updateUserDefaultConferencingAppHandler } from "./updateUserDefaultConferencingApp.handler";

const { mockSetDefaultConferencingApp } = vi.hoisted(() => ({ mockSetDefaultConferencingApp: vi.fn() }));

vi.mock("@calcom/app-store/_utils/setDefaultConferencingApp", () => ({
  default: mockSetDefaultConferencingApp,
}));

vi.mock("@calcom/app-store/delegationCredential", () => ({
  getUsersCredentialsIncludeServiceAccountKey: vi.fn(async () => []),
}));

// Cal Video is a global app, so it counts as installed for every user
vi.mock("@calcom/app-store/utils", () => ({
  default: vi.fn(() => [
    {
      slug: "daily-video",
      appData: { location: { type: "integrations:daily", linkType: "dynamic", label: "Cal Video" } },
    },
  ]),
  getAppFromSlug: vi.fn((slug: string) =>
    slug === "google-meet"
      ? { slug, appData: { location: { type: "integrations:google:meet", linkType: "dynamic" } } }
      : { slug, appData: {} }
  ),
}));

const user = { id: 1, metadata: {} } as unknown as NonNullable<TrpcSessionUser>;

// An app the admin switched off (App.enabled = false) stays off; the seed leaves only google-calendar enabled
describe("default conferencing app with apps the admin switched off", () => {
  beforeEach(() => {
    mockSetDefaultConferencingApp.mockReset();
    prismaMock.app.findMany.mockResolvedValue([]);
  });

  it("refuses to put a disabled app's location on all the user's event types", async () => {
    await expect(
      setDefaultConferencingAppHandler({ ctx: { user }, input: { slug: "google-meet" } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: ErrorCode.AppNotAvailable });

    expect(mockSetDefaultConferencingApp).not.toHaveBeenCalled();
  });

  it("sets an enabled app on the user's event types", async () => {
    prismaMock.app.findMany.mockResolvedValue([{ slug: "google-meet", dirName: "googlevideo" }] as never);

    await setDefaultConferencingAppHandler({ ctx: { user }, input: { slug: "google-meet" } });

    expect(mockSetDefaultConferencingApp).toHaveBeenCalledWith(1, "google-meet");
  });

  it("refuses a disabled app as the user's default conferencing app", async () => {
    await expect(
      updateUserDefaultConferencingAppHandler({ ctx: { user }, input: { appSlug: "daily-video" } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: ErrorCode.AppNotAvailable });

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("makes an enabled app the user's default conferencing app", async () => {
    prismaMock.app.findMany.mockResolvedValue([{ slug: "daily-video", dirName: "dailyvideo" }] as never);

    await updateUserDefaultConferencingAppHandler({ ctx: { user }, input: { appSlug: "daily-video" } });

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
  });
});
