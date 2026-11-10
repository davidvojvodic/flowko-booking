// Flowko U29a: the settings menu has a „Podjetje“ section (profile, services) for the business owner only (S15). It is
// hidden while viewer.flowko.business.me loads, on its error, for a WORKER or STAFF member and for a user in no
// business, whose menus stay exactly as before. The real useFlowkoBusiness / useFlowkoHidesCalScreens run on a mocked
// trpc query.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "./SettingsLayoutAppDirClient";

const mockBusinessMe = vi.fn();
const session = vi.hoisted(() => ({ role: "USER" as "USER" | "ADMIN" }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: 2, role: session.role } } }),
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      me: { get: { useQuery: () => ({ data: { name: "Olga", avatarUrl: null } }) } },
      flowko: { business: { me: { useQuery: () => mockBusinessMe() } } },
    },
  },
}));
vi.mock("~/shell/Shell", () => ({ default: () => null }));

type Tab = { name: string; href: string; icon?: string; children?: { name: string; href: string }[] };

const me = (role: "OWNER" | "WORKER" | "STAFF") => ({
  data: {
    businessId: 9,
    businessName: "Salon",
    businessSlug: "salon",
    memberId: 1,
    role,
    hidesCalScreens: role !== "OWNER",
  },
});

const render = (): Tab[] =>
  renderHook(() => useTabs({ isDelegationCredentialEnabled: false, isPbacEnabled: false })).result
    .current as Tab[];

const names = (tabs: Tab[]): string[] => tabs.map((tab) => tab.name);
const myAccountChildren = (tabs: Tab[]): string[] =>
  (tabs.find((tab) => tab.href === "/settings/my-account")?.children ?? []).map((child) => child.name);

// Today's menu of a user in no business (non-admin): the account (named after the user), security, developer.
const BEFORE = ["Olga", "security", "developer"];

describe("settings tabs (U29a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.role = "USER";
  });

  it("the owner gets „Podjetje“ first, with the profile, the services and the staff", () => {
    mockBusinessMe.mockReturnValue(me("OWNER"));
    const tabs = render();
    expect(names(tabs)).toEqual(["flowko_settings_section", ...BEFORE]);
    const section = tabs[0];
    expect(section.href).toBe("/settings/podjetje");
    expect(section.icon).toBe("building");
    expect(section.children).toEqual([
      { name: "flowko_settings_profile", href: "/settings/podjetje/profil" },
      { name: "flowko_settings_services", href: "/settings/podjetje/storitve" },
      // Flowko U29c: the Delavci page (Task 7), deliberate
      { name: "flowko_workers_title", href: "/settings/podjetje/delavci" },
    ]);
    // the owner keeps Out of office (U27)
    expect(myAccountChildren(tabs)).toContain("out_of_office");
  });

  it.each([
    ["while the answer loads", { data: undefined, error: null }],
    ["for a user in no business", { data: null, error: null }],
    ["on an error without data", { data: undefined, error: new Error("boom") }],
  ])("has no „Podjetje“ %s, and the menu is unchanged", (_name, answer) => {
    mockBusinessMe.mockReturnValue(answer);
    const tabs = render();
    expect(names(tabs)).toEqual(BEFORE);
    expect(myAccountChildren(tabs)).toContain("out_of_office");
  });

  it.each(["WORKER", "STAFF"] as const)("a %s has no „Podjetje“ and keeps the U27 menu", (role) => {
    mockBusinessMe.mockReturnValue(me(role));
    const tabs = render();
    expect(names(tabs)).toEqual(BEFORE);
    expect(tabs.some((tab) => tab.href.startsWith("/settings/podjetje"))).toBe(false);
    expect(myAccountChildren(tabs)).not.toContain("out_of_office");
  });

  // Flowko U29a: the owner check runs before the isAdmin shortcut; an instance admin who does not own the business
  // gets the admin menu without „Podjetje“ (the server guard redirects either way).
  it.each([
    ["in no business", { data: null, error: null }],
    ["who is a WORKER", me("WORKER")],
  ])("an instance ADMIN %s has no „Podjetje“", (_name, answer) => {
    session.role = "ADMIN";
    mockBusinessMe.mockReturnValue(answer);
    const tabs = render();
    expect(names(tabs)).toContain("admin");
    expect(names(tabs)).not.toContain("flowko_settings_section");
    expect(tabs.some((tab) => tab.href.startsWith("/settings/podjetje"))).toBe(false);
  });
});
