// Flowko U28: the settings back button goes to the desk for a business member, to the event types for anyone else.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackButtonInSidebar } from "./SettingsLayoutAppDirClient";

const mockMe = vi.fn();
vi.mock("@calcom/trpc/react", () => ({
  trpc: { viewer: { flowko: { business: { me: { useQuery: () => mockMe() } } } } },
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: 2, role: "USER" } } }) }));
vi.mock("~/shell/Shell", () => ({ default: () => null }));

describe("settings back button (U28)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("goes to /koledar for a business member", () => {
    mockMe.mockReturnValue({ data: { role: "WORKER", hidesCalScreens: true } });
    render(<BackButtonInSidebar name="Back" />);
    expect(screen.getByTestId("vertical-tab-Back").getAttribute("href")).toBe("/koledar");
  });

  it("goes to /event-types for a user in no business", () => {
    mockMe.mockReturnValue({ data: null });
    render(<BackButtonInSidebar name="Back" />);
    expect(screen.getByTestId("vertical-tab-Back").getAttribute("href")).toBe("/event-types");
  });
});
