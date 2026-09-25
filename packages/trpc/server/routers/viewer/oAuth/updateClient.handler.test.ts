import type { NextApiRequest } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@calcom/prisma";

import { updateClientHandler } from "./updateClient.handler";

const mocks = vi.hoisted(() => ({
  findByClientId: vi.fn(),
  updateStatus: vi.fn(),
  update: vi.fn(),
  oAuthClientUpdate: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@calcom/features/oauth/repositories/OAuthClientRepository", () => ({
  OAuthClientRepository: class {
    findByClientId = mocks.findByClientId;
    updateStatus = mocks.updateStatus;
    update = mocks.update;
  },
}));

// The session's JWT, which carries the role validateRole gave it at sign-in
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));

const req = {} as NextApiRequest;
const prisma = { oAuthClient: { update: mocks.oAuthClientUpdate } } as unknown as PrismaClient;

const owner = { id: 1, role: "USER", twoFactorEnabled: false, identityProvider: "CAL" };
const admin = { id: 9, role: "ADMIN", twoFactorEnabled: true, identityProvider: "CAL" };
// An ADMIN without 2FA: validateRole makes them an INACTIVE_ADMIN in the JWT, but the database still says ADMIN
const inactiveAdmin = { ...admin, twoFactorEnabled: false };

// Another tenant's client, waiting for review
const client = {
  clientId: "client_1",
  userId: 1,
  name: "Salon app",
  purpose: "Bookings",
  redirectUri: "https://salon.example/callback",
  websiteUrl: null,
  logo: null,
  status: "PENDING",
  rejectionReason: null,
};

const run = (user: typeof admin | typeof owner, input: Parameters<typeof updateClientHandler>[0]["input"]) =>
  updateClientHandler({ ctx: { user, prisma, req }, input });

describe("oAuth.updateClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByClientId.mockResolvedValue(client);
    mocks.getToken.mockResolvedValue({ role: "ADMIN" });
  });

  it("lets an active admin approve a client", async () => {
    await expect(run(admin, { clientId: "client_1", status: "APPROVED" })).resolves.toMatchObject({
      clientId: "client_1",
    });

    expect(mocks.updateStatus).toHaveBeenCalledWith("client_1", "APPROVED");
  });

  it("lets an active admin edit another user's client", async () => {
    await run(admin, { clientId: "client_1", name: "Renamed" });

    expect(mocks.update).toHaveBeenCalledWith("client_1", { name: "Renamed" });
  });

  it("refuses a status change from an admin with two-factor authentication off", async () => {
    await expect(
      run(inactiveAdmin, { clientId: "client_1", status: "REJECTED", rejectionReason: "no" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.updateStatus).not.toHaveBeenCalled();
    expect(mocks.oAuthClientUpdate).not.toHaveBeenCalled();
  });

  it("refuses an admin with two-factor authentication off another user's redirect URI", async () => {
    await expect(
      run(inactiveAdmin, { clientId: "client_1", redirectUri: "https://attacker.example/callback" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it("refuses an admin whose session signed in as INACTIVE_ADMIN", async () => {
    mocks.getToken.mockResolvedValue({ role: "INACTIVE_ADMIN" });

    await expect(run(admin, { clientId: "client_1", status: "APPROVED" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(run(admin, { clientId: "client_1", name: "Renamed" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    expect(mocks.updateStatus).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("lets the owner edit their own client, but not approve it", async () => {
    await run(owner, { clientId: "client_1", name: "Renamed" });
    expect(mocks.update).toHaveBeenCalledWith("client_1", { name: "Renamed" });

    await expect(run(owner, { clientId: "client_1", status: "APPROVED" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it("refuses another user's client to someone who isn't an admin", async () => {
    await expect(run({ ...owner, id: 2 }, { clientId: "client_1", name: "Renamed" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    expect(mocks.update).not.toHaveBeenCalled();
  });
});
