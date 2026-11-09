// Flowko U27: a non-owner business member's settings menu has no "Out of office" entry (Holidays is a tab of that
// page); everything else in "My account" stays.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabs } from "./SettingsLayoutAppDirClient";

const mockHides = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoHidesCalScreens", () => ({
  useFlowkoHidesCalScreens: () => mockHides(),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: 2, role: "USER" } } }),
}));
// Flowko U29a: useTabs also reads viewer.flowko.business.me (the owner's business tab); here: no business
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      me: { get: { useQuery: () => ({ data: { name: "Ana", avatarUrl: null } }) } },
      flowko: { business: { me: { useQuery: () => ({ data: null }) } } },
    },
  },
}));
vi.mock("~/shell/Shell", () => ({ default: () => null }));

const myAccountChildren = (tabs: { href: string; children?: { name: string }[] }[]): string[] =>
  (tabs.find((tab) => tab.href === "/settings/my-account")?.children ?? []).map((child) => child.name);

const render = () =>
  renderHook(() => useTabs({ isDelegationCredentialEnabled: false, isPbacEnabled: false })).result.current;

describe("settings tabs (U27)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists Out of office for a user who is not hidden", () => {
    mockHides.mockReturnValue(false);
    expect(myAccountChildren(render())).toContain("out_of_office");
  });

  it("drops only Out of office for a non-owner member", () => {
    mockHides.mockReturnValue(true);
    const children = myAccountChildren(render());
    expect(children).not.toContain("out_of_office");
    expect(children).toEqual(
      expect.arrayContaining(["profile", "general", "calendars", "conferencing", "appearance"])
    );
  });
});
