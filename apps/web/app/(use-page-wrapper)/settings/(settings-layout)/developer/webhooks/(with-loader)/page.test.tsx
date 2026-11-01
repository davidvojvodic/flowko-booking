import { beforeEach, describe, expect, it, vi } from "vitest";

// Flowko U14: a non-admin who opens the webhooks settings by URL gets the not-found page, never a crash.

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUser: vi.fn(),
  isAdmin: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  getByViewer: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({}) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("app/_trpc/context", () => ({
  createRouterCaller: async () => ({ getByViewer: mocks.getByViewer }),
}));
vi.mock("app/_utils", () => ({ _generateMetadata: vi.fn() }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@calcom/features/auth/lib/isActiveInstanceAdmin", () => ({
  isActiveInstanceAdminSession: mocks.isAdmin,
}));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: class {
    findUnlockedUserForSession = mocks.findUser;
  },
}));
vi.mock("@calcom/prisma", () => ({ default: {} }));
vi.mock("@calcom/trpc/server/routers/viewer/webhook/_router", () => ({ webhookRouter: {} }));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: () => ({}) }));
vi.mock("~/webhooks/views/webhooks-view", () => ({ default: () => null }));

import Page from "./page";

describe("webhooks settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: 4 } });
  });

  it("answers not-found for a non-admin", async () => {
    mocks.findUser.mockResolvedValue({ id: 4, role: "USER" });
    mocks.isAdmin.mockResolvedValue(false);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getByViewer).not.toHaveBeenCalled();
  });

  it("answers not-found when the admin lookup itself fails", async () => {
    mocks.findUser.mockRejectedValue(new Error("database down"));
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers not-found when the user row is gone", async () => {
    mocks.findUser.mockResolvedValue(null);
    mocks.isAdmin.mockResolvedValue(false);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
