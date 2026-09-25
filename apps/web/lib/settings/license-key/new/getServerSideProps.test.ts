import type { GetServerSidePropsContext } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUnlockedUserForSession: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@calcom/feature-auth/lib/getServerSession", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@calcom/feature-auth/lib/next-auth-options", () => ({ getOptions: vi.fn(() => ({})) }));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: vi.fn(function UserRepository() {
    return { findUnlockedUserForSession: mocks.findUnlockedUserForSession };
  }),
}));
// The session's JWT, which carries the role validateRole gave it at sign-in
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));
vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));

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

describe("/settings/license-key/new getServerSideProps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders for an admin with 2FA", async () => {
    signIn({ twoFactorEnabled: true, signInRole: "ADMIN" });

    await expect(getServerSideProps(context)).resolves.toEqual({ props: {} });
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

  it("is still not found for a user who isn't an admin, or no one", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: 1, role: "USER" } });
    await expect(getServerSideProps(context)).resolves.toEqual({ notFound: true });

    mocks.getServerSession.mockResolvedValue(null);
    await expect(getServerSideProps(context)).resolves.toEqual({ notFound: true });

    expect(mocks.findUnlockedUserForSession).not.toHaveBeenCalled();
  });
});
