import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsernameAvailabilityField } from "./index";

// Flowko U20: the field takes the user its page already holds. Its old suspense query ran during
// the server render without cookies, failed, and turned the page section into React #419.
const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      me: {
        get: {
          useQuery: mocks.useQuery,
          useSuspenseQuery: () => {
            throw new Error("useSuspenseQuery must not be called");
          },
        },
      },
    },
  },
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.searchParams }));

vi.mock("@lib/hooks/useRouterQuery", () => ({
  default: (name: string) => ({ [name]: mocks.searchParams.get(name) ?? undefined, setQuery: vi.fn() }),
}));

// Both text fields are next/dynamic ssr:false; stand in for them with one plain input.
vi.mock("next/dynamic", () => ({
  default: () => (props: { currentUsername?: string; disabled?: boolean; readonly?: boolean }) => (
    <input
      data-testid="username-input"
      value={props.currentUsername ?? ""}
      readOnly
      disabled={Boolean(props.disabled ?? props.readonly)}
    />
  ),
}));

describe("UsernameAvailabilityField", () => {
  beforeEach(() => {
    mocks.useQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: undefined });
    mocks.searchParams = new URLSearchParams();
  });

  it("renders from the user prop without querying", () => {
    render(<UsernameAvailabilityField user={{ username: "ana", organization: null }} />);
    expect(screen.getByTestId("username-input")).toHaveValue("ana");
    expect(mocks.useQuery).toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: false }));
  });

  it("no prop and no data shows the placeholder", () => {
    render(<UsernameAvailabilityField />);
    expect(screen.getByTestId("username-field-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("username-input")).not.toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: true }));
  });

  it("organisation member stays disabled", () => {
    render(<UsernameAvailabilityField user={{ username: "ana", organization: { id: 7 } as never }} />);
    expect(screen.getByTestId("username-input")).toBeDisabled();
  });

  it("signup handover keeps ?username", () => {
    mocks.searchParams = new URLSearchParams("username=foo");
    render(<UsernameAvailabilityField user={{ username: null, organization: null }} />);
    expect(screen.getByTestId("username-input")).toHaveValue("foo");
  });
});
