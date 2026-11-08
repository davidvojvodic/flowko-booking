// Flowko U27: the palette offers Cal's Event types and Availability shortcuts unless the user is a non-owner
// business member; the flag arrives after the first render, so a hidden member's shortcuts leave again.
import { render, screen, waitFor } from "@testing-library/react";
import { useKBar } from "kbar";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KBarContent, KBarRoot } from "./Kbar";

const mockHides = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoHidesCalScreens", () => ({
  useFlowkoHidesCalScreens: () => mockHides(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated", data: { user: { id: 2, role: "USER" } } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "sl" } }),
}));
vi.mock("@calcom/app-store/appStoreMetaData", () => ({ appStoreMetadata: {} }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      eventTypes: { getEventTypesFromGroup: { useInfiniteQuery: () => ({ data: undefined }) } },
      bookings: { get: { useQuery: () => ({ data: undefined }) } },
    },
  },
}));

function RegisteredActionIds(): JSX.Element {
  const { actions } = useKBar((state) => ({ actions: state.actions }));
  return <div data-testid="action-ids">{Object.keys(actions).sort().join(",")}</div>;
}
const tree = (): JSX.Element => (
  <KBarRoot>
    <RegisteredActionIds />
    <KBarContent />
  </KBarRoot>
);
const ids = (): string[] => screen.getByTestId("action-ids").textContent?.split(",") ?? [];

describe("Kbar Cal-screen shortcuts (U27)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers Event types and Availability to a user who is not hidden", async () => {
    mockHides.mockReturnValue(false);
    render(tree());
    await waitFor(() => expect(ids()).toContain("event-types"));
    expect(ids()).toContain("schedule");
    expect(ids()).toContain("upcoming-bookings");
  });

  it("leaves both out for a non-owner member and keeps the rest", async () => {
    mockHides.mockReturnValue(true);
    render(tree());
    await waitFor(() => expect(ids()).toContain("upcoming-bookings"));
    expect(ids()).not.toContain("event-types");
    expect(ids()).not.toContain("schedule");
    expect(ids()).toContain("profile");
  });

  it("removes them again once the flag turns true after the first render", async () => {
    mockHides.mockReturnValue(false);
    const { rerender } = render(tree());
    await waitFor(() => expect(ids()).toContain("schedule"));

    mockHides.mockReturnValue(true);
    rerender(tree());
    await waitFor(() => expect(ids()).not.toContain("schedule"));
    expect(ids()).not.toContain("event-types");
  });
});
