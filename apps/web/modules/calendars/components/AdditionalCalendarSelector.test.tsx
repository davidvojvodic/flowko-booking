import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AdditionalCalendarSelector from "./AdditionalCalendarSelector";

// Flowko U20: the "Dodaj" calendar dropdown must not suspend; its suspense query failed during the
// server render (no cookies) and caused React #419 on /apps/installed/calendar.
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

describe("AdditionalCalendarSelector", () => {
  it("renders the add button before data arrives", () => {
    render(<AdditionalCalendarSelector />);
    expect(screen.getByRole("button", { name: "add" })).toBeInTheDocument();
  });
});
