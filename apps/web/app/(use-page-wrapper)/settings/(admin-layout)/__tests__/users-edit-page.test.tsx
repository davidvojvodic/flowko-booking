import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUnlockedUserForSession: vi.fn(),
  adminFindById: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: vi.fn(function UserRepository() {
    return {
      findUnlockedUserForSession: mocks.findUnlockedUserForSession,
      adminFindById: mocks.adminFindById,
    };
  }),
}));
// The session's JWT, which carries the role validateRole gave it at sign-in
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));
vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("app/_utils", () => ({
  _generateMetadata: vi.fn(async (getTitle: (t: (key: string) => string) => string) => ({
    title: getTitle((key) => key),
  })),
  getTranslate: vi.fn(async () => (key: string) => key),
}));
vi.mock("@calcom/features/settings/appDir/SettingsHeader", () => ({ default: () => null }));
vi.mock("@calcom/web/modules/users/views/users-edit-view", () => ({ UsersEditView: () => null }));

import Page, { generateMetadata } from "../admin/users/[id]/edit/page";

const params = Promise.resolve({ id: "2" });
const render = () => Page({ params: Promise.resolve({ id: "2" }) });

const tenant = { id: 2, username: "salon-ana", email: "ana@example.com" };

function signIn({
  role,
  twoFactorEnabled,
  signInRole,
}: {
  role: "ADMIN" | "USER";
  twoFactorEnabled: boolean;
  signInRole: string;
}) {
  mocks.getServerSession.mockResolvedValue({ user: { id: 9, role } });
  mocks.findUnlockedUserForSession.mockResolvedValue({
    id: 9,
    role,
    twoFactorEnabled,
    identityProvider: "CAL",
  });
  mocks.getToken.mockResolvedValue({ role: signInRole });
}

describe("admin user edit page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminFindById.mockResolvedValue(tenant);
  });

  it("renders the user for an active admin", async () => {
    signIn({ role: "ADMIN", twoFactorEnabled: true, signInRole: "ADMIN" });

    const element = await render();

    expect(mocks.adminFindById).toHaveBeenCalledWith(2);
    expect(element.props.children.props.user).toBe(tenant);
    await expect(generateMetadata({ params })).resolves.toEqual({ title: "editing_user: salon-ana" });
  });

  describe.each([
    ["a signed-out visitor", null],
    ["a tenant", { role: "USER", twoFactorEnabled: true, signInRole: "USER" }],
    ["an admin who signed in as INACTIVE_ADMIN", { role: "ADMIN", twoFactorEnabled: true, signInRole: "INACTIVE_ADMIN" }],
    ["an admin with two-factor authentication off", { role: "ADMIN", twoFactorEnabled: false, signInRole: "ADMIN" }],
  ] as const)("for %s", (_name, viewer) => {
    beforeEach(() => {
      if (viewer) signIn(viewer);
      else mocks.getServerSession.mockResolvedValue(null);
    });

    it("sends them to their profile, as the layout does, without looking the user up", async () => {
      await expect(render()).rejects.toThrow("NEXT_REDIRECT /settings/my-account/profile");
      expect(mocks.adminFindById).not.toHaveBeenCalled();
    });

    it("gives generateMetadata the generic title without looking the user up", async () => {
      await expect(generateMetadata({ params })).resolves.toEqual({ title: "editing_user" });
      expect(mocks.adminFindById).not.toHaveBeenCalled();
    });
  });
});
