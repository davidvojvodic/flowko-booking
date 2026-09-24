import type { GetServerSidePropsContext } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUnlockedUserForSession: vi.fn(),
  getToken: vi.fn(),
  userCount: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: vi.fn(function UserRepository() {
    return { findUnlockedUserForSession: mocks.findUnlockedUserForSession };
  }),
}));
// The session's JWT, which carries the role validateRole gave it at sign-in
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));
vi.mock("@calcom/prisma", () => {
  const prisma = { user: { count: mocks.userCount }, deployment: { upsert: vi.fn() } };
  return { default: prisma, prisma };
});

import { getServerSideProps } from "./getServerSideProps";

const context = { req: { headers: {}, cookies: {} } } as unknown as GetServerSidePropsContext;

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

describe("/auth/setup getServerSideProps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userCount.mockResolvedValue(3);
  });

  it("renders for an admin with 2FA", async () => {
    signIn({ twoFactorEnabled: true, signInRole: "ADMIN" });

    await expect(getServerSideProps(context)).resolves.toEqual({
      props: { isFreeLicense: true, userCount: 3, hasValidLicense: false },
    });
    expect(mocks.findUnlockedUserForSession).toHaveBeenCalledWith({ userId: 9 });
  });

  it("is not found for an admin with two-factor authentication off", async () => {
    signIn({ twoFactorEnabled: false, signInRole: "ADMIN" });

    await expect(getServerSideProps(context)).resolves.toEqual({ notFound: true });
  });

  it("is not found for an admin whose session signed in as INACTIVE_ADMIN", async () => {
    signIn({ twoFactorEnabled: true, signInRole: "INACTIVE_ADMIN" });

    await expect(getServerSideProps(context)).resolves.toEqual({ notFound: true });
  });

  it("is still not found for a user who isn't an admin", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: 1, role: "USER" } });

    await expect(getServerSideProps(context)).resolves.toEqual({ notFound: true });
    expect(mocks.findUnlockedUserForSession).not.toHaveBeenCalled();
  });

  // Once a user exists there is nothing to set up without signing in, and the page would tell the user count
  it("is not found signed out once a user exists", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    await expect(getServerSideProps(context)).resolves.toEqual({ notFound: true });
  });

  it("renders signed out on a fresh install, where the first admin is created", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    mocks.userCount.mockResolvedValue(0);

    await expect(getServerSideProps(context)).resolves.toEqual({
      props: { isFreeLicense: true, userCount: 0, hasValidLicense: false },
    });
  });
});
