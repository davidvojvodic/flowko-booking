import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { describe, expect, it } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";

import { createHandler } from "./create.handler";

const ctx = { user: { id: 1 } };

describe("apiKeys.create with apps the admin switched off", () => {
  it("refuses a key for a disabled app without writing one", async () => {
    prismaMock.app.findUnique.mockResolvedValue({ enabled: false } as never);

    await expect(createHandler({ ctx, input: { appId: "zapier", neverExpires: true } })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: ErrorCode.AppNotAvailable,
    });

    expect(prismaMock.app.findUnique).toHaveBeenCalledWith({
      where: { slug: "zapier" },
      select: { enabled: true },
    });
    expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
  });

  it.each([["make"], ["not-an-app"], [""]])("refuses appId %j without an enabled App row", async (appId) => {
    prismaMock.app.findUnique.mockResolvedValue(null);

    await expect(createHandler({ ctx, input: { appId, neverExpires: true } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
  });

  it("makes a key for an enabled app", async () => {
    prismaMock.app.findUnique.mockResolvedValue({ enabled: true } as never);

    const key = await createHandler({ ctx, input: { appId: "zapier", neverExpires: true } });

    expect(key).toEqual(expect.any(String));
    expect(prismaMock.apiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 1, appId: "zapier", expiresAt: null }),
    });
  });

  it("makes a personal key without an appId and without looking up an app", async () => {
    const expiresAt = new Date("2026-12-31T00:00:00Z");

    const key = await createHandler({ ctx, input: { note: "my key", expiresAt } });

    expect(key).toEqual(expect.any(String));
    expect(prismaMock.app.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.apiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 1, note: "my key", expiresAt }),
    });
  });

  it("makes a personal key when appId is null", async () => {
    const key = await createHandler({ ctx, input: { appId: null, neverExpires: true } });

    expect(key).toEqual(expect.any(String));
    expect(prismaMock.app.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.apiKey.create).toHaveBeenCalledTimes(1);
  });
});
