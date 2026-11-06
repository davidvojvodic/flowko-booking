// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import AdditionalCalendarSelector from "./AdditionalCalendarSelector";

// Flowko U20: on the server the dropdown renders its trigger without querying.
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      apps: {
        integrations: {
          useQuery: () => ({ data: undefined }),
          useSuspenseQuery: () => {
            throw new Error("useSuspenseQuery must not be called");
          },
        },
      },
    },
  },
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

vi.mock("@calcom/app-store/InstallAppButton", () => ({ InstallAppButton: () => null }));

vi.mock("@calcom/app-store/_components/GoogleCalendarConnectNotice", () => ({
  GoogleCalendarConnectNoticeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("AdditionalCalendarSelector on the server", () => {
  it("server render does not throw", () => {
    expect(() => renderToString(<AdditionalCalendarSelector />)).not.toThrow();
  });
});
