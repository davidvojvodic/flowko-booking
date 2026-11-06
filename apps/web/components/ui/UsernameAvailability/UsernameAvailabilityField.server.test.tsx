// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { UsernameAvailabilityField } from "./index";

// Flowko U20: with the user passed in, the field renders on the server without touching tRPC.
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      me: {
        get: {
          useQuery: () => ({ data: undefined }),
          useSuspenseQuery: () => {
            throw new Error("useSuspenseQuery must not be called");
          },
        },
      },
    },
  },
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

vi.mock("@lib/hooks/useRouterQuery", () => ({
  default: (name: string) => ({ [name]: undefined, setQuery: () => undefined }),
}));

vi.mock("next/dynamic", () => ({
  default: () => (props: { currentUsername?: string }) => (
    <input data-testid="username-input" value={props.currentUsername ?? ""} readOnly />
  ),
}));

describe("UsernameAvailabilityField on the server", () => {
  it("server render with the user prop does not throw and shows no placeholder", () => {
    const html = renderToString(
      <UsernameAvailabilityField user={{ username: "ana", organization: { id: null } as never }} />
    );
    // Flowko U21: value="ana" is printed by this file's next/dynamic mock, so it only shows that the user
    // prop reached the inner field. It says nothing about the real UsernameTextfield markup.
    expect(html).toContain('value="ana"');
    expect(html).not.toContain("username-field-placeholder");
  });
});
