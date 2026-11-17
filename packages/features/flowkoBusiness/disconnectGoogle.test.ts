// Flowko U25: removing a locked worker's Google credentials (calendar and Meet) through Cal's delete path, on the
// global client (Ruling 3: its own file, prismaMock). handleDeleteCredential is mocked: it calls Google.
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const google = vi.hoisted(() => ({ deleteCredential: vi.fn(), imported: { count: 0 } }));
vi.mock("@calcom/features/credentials/handleDeleteCredential", () => {
  google.imported.count += 1;
  return { default: google.deleteCredential };
});

// Flowko U30: R8 — the step events are removed through googleStepSync.ts (it calls Google): mocked.
const steps = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("./googleStepSync", () => ({ removeStepEventsOfUser: steps.remove }));

import { disconnectGoogleOfUser } from "./disconnectGoogle";

const METADATA = { defaultConferencingApp: { appSlug: "google-meet", appLink: "" } };

describe("disconnectGoogleOfUser", () => {
  beforeEach(() => {
    google.deleteCredential.mockReset();
    google.deleteCredential.mockResolvedValue(undefined);
    steps.remove.mockReset();
    steps.remove.mockResolvedValue("none");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("no credential answers none without loading the delete path", async () => {
    prismaMock.credential.findMany.mockResolvedValue([] as never);

    await expect(disconnectGoogleOfUser(7)).resolves.toBe("none");
    expect(google.deleteCredential).not.toHaveBeenCalled();
    // The lazy import has not run yet: this test runs first in the file, before any delete.
    expect(google.imported.count).toBe(0);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("deletes every google_calendar and google_video credential with the user's metadata", async () => {
    prismaMock.credential.findMany.mockResolvedValue([{ id: 11 }, { id: 12 }, { id: 13 }] as never);
    prismaMock.user.findFirst.mockResolvedValue({ metadata: METADATA } as never);

    await expect(disconnectGoogleOfUser(7)).resolves.toBe("disconnected");

    const credentialQuery = prismaMock.credential.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(credentialQuery.where).toEqual({ userId: 7, type: { in: ["google_calendar", "google_video"] } });
    const userQuery = prismaMock.user.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    // The user is already Cal-locked: the read opts out of excludeLockedUsers.
    expect(userQuery.where).toEqual({ id: 7, OR: [{ locked: false }, { locked: true }] });
    expect(google.deleteCredential.mock.calls.map((c) => c[0])).toEqual([
      { userId: 7, userMetadata: METADATA, credentialId: 11 },
      { userId: 7, userMetadata: METADATA, credentialId: 12 },
      { userId: 7, userMetadata: METADATA, credentialId: 13 },
    ]);
  });

  it("a throwing delete answers failed and the others are still tried", async () => {
    prismaMock.credential.findMany.mockResolvedValue([{ id: 11 }, { id: 12 }, { id: 13 }] as never);
    prismaMock.user.findFirst.mockResolvedValue({ metadata: METADATA } as never);
    google.deleteCredential
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("keyring unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(disconnectGoogleOfUser(7)).resolves.toBe("failed");
    expect(google.deleteCredential).toHaveBeenCalledTimes(3);
    expect(google.deleteCredential.mock.calls[2][0]).toMatchObject({ credentialId: 13 });
  });

  it("a failed credential lookup answers failed", async () => {
    prismaMock.credential.findMany.mockRejectedValue(new Error("db down"));

    await expect(disconnectGoogleOfUser(7)).resolves.toBe("failed");
    expect(google.deleteCredential).not.toHaveBeenCalled();
  });

  // Flowko U30: R8
  describe("step events first", () => {
    const CREDENTIALS = [{ id: 11 }, { id: 12 }];

    beforeEach(() => {
      prismaMock.credential.findMany.mockResolvedValue(CREDENTIALS as never);
      prismaMock.user.findFirst.mockResolvedValue({ metadata: METADATA } as never);
    });

    it("removed → the credentials are deleted afterwards and the answer is disconnected", async () => {
      const removeStepEvents = vi.fn(async () => "removed" as const);
      await expect(disconnectGoogleOfUser(7, { removeStepEvents })).resolves.toBe("disconnected");
      expect(removeStepEvents).toHaveBeenCalledWith(7);
      expect(google.deleteCredential).toHaveBeenCalledTimes(2);
      expect(removeStepEvents.mock.invocationCallOrder[0]).toBeLessThan(
        google.deleteCredential.mock.invocationCallOrder[0]
      );
    });

    it("none (nothing to remove, or no Google target) → the credentials are deleted", async () => {
      const removeStepEvents = vi.fn(async () => "none" as const);
      await expect(disconnectGoogleOfUser(7, { removeStepEvents })).resolves.toBe("disconnected");
      expect(google.deleteCredential).toHaveBeenCalledTimes(2);
    });

    it("failed → no credential is deleted and the answer is failed; a later retry removes them", async () => {
      const removeStepEvents = vi
        .fn<(userId: number) => Promise<"none" | "removed" | "failed">>()
        .mockResolvedValueOnce("failed")
        .mockResolvedValueOnce("removed");
      await expect(disconnectGoogleOfUser(7, { removeStepEvents })).resolves.toBe("failed");
      expect(google.deleteCredential).not.toHaveBeenCalled();
      await expect(disconnectGoogleOfUser(7, { removeStepEvents })).resolves.toBe("disconnected");
      expect(google.deleteCredential).toHaveBeenCalledTimes(2);
    });

    it("a throwing removal answers failed without deleting anything, logged by class only", async () => {
      const removeStepEvents = vi.fn(async () => {
        throw new TypeError("token for marija@example.com");
      });
      await expect(disconnectGoogleOfUser(7, { removeStepEvents })).resolves.toBe("failed");
      expect(google.deleteCredential).not.toHaveBeenCalled();
    });

    it("no credential: the removal is not asked", async () => {
      prismaMock.credential.findMany.mockResolvedValue([] as never);
      const removeStepEvents = vi.fn(async () => "removed" as const);
      await expect(disconnectGoogleOfUser(7, { removeStepEvents })).resolves.toBe("none");
      expect(removeStepEvents).not.toHaveBeenCalled();
    });

    it("the default removal is removeStepEventsOfUser on the global client for this user, with the current time", async () => {
      steps.remove.mockResolvedValue("removed");
      const before = Date.now();
      await expect(disconnectGoogleOfUser(7)).resolves.toBe("disconnected");
      expect(steps.remove).toHaveBeenCalledTimes(1);
      const [client, userId, now] = steps.remove.mock.calls[0] as [unknown, number, Date];
      expect(client).toBe(prismaMock);
      expect(userId).toBe(7);
      expect(now).toBeInstanceOf(Date);
      expect(now.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("the default removal answering failed keeps the credentials", async () => {
      steps.remove.mockResolvedValue("failed");
      await expect(disconnectGoogleOfUser(7)).resolves.toBe("failed");
      expect(google.deleteCredential).not.toHaveBeenCalled();
    });
  });
});
