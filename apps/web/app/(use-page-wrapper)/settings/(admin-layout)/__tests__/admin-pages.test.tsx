import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUnlockedUserForSession: vi.fn(),
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
  usePathname: vi.fn(() => "/settings/admin/playground"),
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
vi.mock("app/_utils", () => ({
  _generateMetadata: vi.fn(async (getTitle: (t: (key: string) => string) => string) => ({
    title: getTitle((key) => key),
  })),
  getTranslate: vi.fn(async () => (key: string) => key),
}));
vi.mock("@calcom/features/settings/appDir/SettingsHeader", () => ({ default: () => null }));
vi.mock("@calcom/web/modules/apps/components/AdminAppsList", () => ({ default: () => null }));
vi.mock("@calcom/web/modules/feature-flags/views/flag-listing-view", () => ({ FlagListingView: () => null }));
vi.mock("@calcom/web/modules/settings/admin/locked-sms-view", () => ({ default: () => null }));
vi.mock("@calcom/web/modules/settings/admin/oauth-clients-admin-view", () => ({ default: () => null }));
vi.mock("@calcom/web/modules/users/views/users-listing-view", () => ({ default: () => null }));
vi.mock("@calcom/web/modules/users/views/users-add-view", () => ({ default: () => null }));
vi.mock("@calcom/ui/components/button", () => ({ Button: () => null }));
vi.mock("@calcom/ui/components/icon", () => ({ Icon: () => null }));

type ServerComponent = (props: never) => Promise<unknown>;

// Every server page under (admin-layout), rendered as a partial render would: without the layout
const pages: [string, () => Promise<{ default: unknown }>][] = [
  ["admin", () => import("../admin/page")],
  ["admin/apps/[category]", () => import("../admin/apps/[category]/page")],
  ["admin/flags", () => import("../admin/flags/page")],
  ["admin/lockedSMS", () => import("../admin/lockedSMS/page")],
  ["admin/oauth", () => import("../admin/oauth/page")],
  ["admin/playground", () => import("../admin/playground/page")],
  ["admin/users", () => import("../admin/users/page")],
  ["admin/users/add", () => import("../admin/users/add/page")],
];

async function render(load: () => Promise<{ default: unknown }>) {
  const Page = (await load()).default as ServerComponent;
  return Page({ params: Promise.resolve({ category: "calendar" }) } as never);
}

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

describe.each(pages)("admin page %s", (_route, load) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders for an active admin", async () => {
    signIn({ role: "ADMIN", twoFactorEnabled: true, signInRole: "ADMIN" });

    await expect(render(load)).resolves.toBeTruthy();
  });

  it.each([
    ["a signed-out visitor", null],
    ["a tenant", { role: "USER", twoFactorEnabled: true, signInRole: "USER" }],
    ["an admin who signed in as INACTIVE_ADMIN", { role: "ADMIN", twoFactorEnabled: true, signInRole: "INACTIVE_ADMIN" }],
    ["an admin with two-factor authentication off", { role: "ADMIN", twoFactorEnabled: false, signInRole: "ADMIN" }],
  ] as const)("sends %s to their profile, as the layout does", async (_name, viewer) => {
    if (viewer) signIn(viewer);
    else mocks.getServerSession.mockResolvedValue(null);

    await expect(render(load)).rejects.toThrow("NEXT_REDIRECT /settings/my-account/profile");
  });
});
