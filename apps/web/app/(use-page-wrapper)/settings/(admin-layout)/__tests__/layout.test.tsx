import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUnlockedUserForSession: vi.fn(),
  getToken: vi.fn(),
  settingsLayout: vi.fn(async () => "admin pages"),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: vi.fn(function UserRepository() {
    return { findUnlockedUserForSession: mocks.findUnlockedUserForSession };
  }),
}));
// The session's JWT, which carries the role validateRole gave it at sign-in
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));
vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("../../(settings-layout)/layout", () => ({ default: mocks.settingsLayout }));
vi.mock("../AdminLayoutAppDirClient", () => ({ default: () => null }));

import AdminLayout from "../layout";

const render = () => AdminLayout({ children: null } as Parameters<typeof AdminLayout>[0]);

// validateRole demotes an ADMIN without 2FA or a strong password to INACTIVE_ADMIN only in the JWT, while the
// session role and the user row come from the database and still say ADMIN
function signIn({ twoFactorEnabled, signInRole }: { twoFactorEnabled: boolean; signInRole: string }) {
  mocks.getServerSession.mockResolvedValue({ user: { id: 9, role: "ADMIN" } });
  mocks.findUnlockedUserForSession.mockResolvedValue({
    id: 9,
    role: "ADMIN",
    twoFactorEnabled,
    identityProvider: "CAL",
  });
  mocks.getToken.mockResolvedValue({ role: signInRole });
}

describe("admin settings layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the admin pages to an admin with 2FA", async () => {
    signIn({ twoFactorEnabled: true, signInRole: "ADMIN" });

    await expect(render()).resolves.toBe("admin pages");
    expect(mocks.findUnlockedUserForSession).toHaveBeenCalledWith({ userId: 9 });
  });

  it("sends an admin with two-factor authentication off to their profile", async () => {
    signIn({ twoFactorEnabled: false, signInRole: "ADMIN" });

    await expect(render()).rejects.toThrow("NEXT_REDIRECT /settings/my-account/profile");
    expect(mocks.settingsLayout).not.toHaveBeenCalled();
  });

  it("sends an admin whose session signed in as INACTIVE_ADMIN to their profile", async () => {
    signIn({ twoFactorEnabled: true, signInRole: "INACTIVE_ADMIN" });

    await expect(render()).rejects.toThrow("NEXT_REDIRECT /settings/my-account/profile");
    expect(mocks.settingsLayout).not.toHaveBeenCalled();
  });

  it("still sends a user who isn't an admin, or no one, to the profile", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: 1, role: "USER" } });
    await expect(render()).rejects.toThrow("NEXT_REDIRECT /settings/my-account/profile");

    mocks.getServerSession.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NEXT_REDIRECT /settings/my-account/profile");

    expect(mocks.findUnlockedUserForSession).not.toHaveBeenCalled();
    expect(mocks.settingsLayout).not.toHaveBeenCalled();
  });
});
