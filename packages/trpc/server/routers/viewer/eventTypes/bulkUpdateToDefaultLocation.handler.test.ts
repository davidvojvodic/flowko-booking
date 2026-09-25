import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";

import type { TrpcSessionUser } from "../../../types";
import { bulkUpdateToDefaultLocationHandler } from "./bulkUpdateToDefaultLocation.handler";

const { mockBulkUpdate } = vi.hoisted(() => ({ mockBulkUpdate: vi.fn() }));

vi.mock("@calcom/app-store/_utils/bulkUpdateEventsToDefaultLocation", () => ({
  bulkUpdateEventsToDefaultLocation: mockBulkUpdate,
}));

const userWithDefaultApp = (appSlug: string) =>
  ({
    id: 1,
    metadata: { defaultConferencingApp: { appSlug, appLink: "https://meet.google.com/abc-defg-hij" } },
  }) as unknown as NonNullable<TrpcSessionUser>;

// An app the admin switched off (App.enabled = false) stays off for event types; only google-calendar is on
describe("bulkUpdateToDefaultLocationHandler", () => {
  beforeEach(() => {
    mockBulkUpdate.mockReset();
    mockBulkUpdate.mockResolvedValue({ count: 2 });
  });

  it("refuses to set a disabled default conferencing app on the event types", async () => {
    prismaMock.app.findMany.mockResolvedValue([]);

    await expect(
      bulkUpdateToDefaultLocationHandler({
        ctx: { user: userWithDefaultApp("google-meet") },
        input: { eventTypeIds: [1, 2] },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: ErrorCode.AppNotAvailable });

    expect(mockBulkUpdate).not.toHaveBeenCalled();
  });

  it("sets an enabled default conferencing app on the event types", async () => {
    prismaMock.app.findMany.mockResolvedValue([{ slug: "google-meet", dirName: "googlevideo" }] as never);

    await expect(
      bulkUpdateToDefaultLocationHandler({
        ctx: { user: userWithDefaultApp("google-meet") },
        input: { eventTypeIds: [1, 2] },
      })
    ).resolves.toEqual({ count: 2 });

    expect(mockBulkUpdate).toHaveBeenCalledTimes(1);
  });
});
