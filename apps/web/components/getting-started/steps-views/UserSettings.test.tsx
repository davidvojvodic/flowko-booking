import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { UserSettings } from "./UserSettings";

// Flowko U20: the time-zone select and the current time depend on the browser's zone; the server
// renders a placeholder so the first browser render matches (no React #418).
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ viewer: { me: { invalidate: vi.fn() } } }),
    viewer: { me: { updateProfile: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } } },
  },
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

vi.mock("@calcom/features/bookings/lib", () => ({
  useTimePreferences: () => ({ timezone: "Europe/Ljubljana", setTimezone: vi.fn() }),
}));

vi.mock("@calcom/web/modules/timezone/components/TimezoneSelect", () => ({
  TimezoneSelect: () => <div data-testid="timezone-select" />,
}));

vi.mock("@components/ui/UsernameAvailability", () => ({ UsernameAvailabilityField: () => null }));

const user = { name: "Ana", username: "ana", organization: null } as never;

describe("UserSettings time-zone block", () => {
  it("server render shows a placeholder instead of the select and the time", () => {
    const html = renderToString(<UserSettings nextStep={vi.fn()} user={user} />);
    expect(html).toContain("timezone-placeholder");
    expect(html).not.toContain("timezone-select");
    expect(html).not.toContain("current_time");
  });

  it("browser render shows the select and the current time", () => {
    render(<UserSettings nextStep={vi.fn()} user={user} />);
    expect(screen.getByTestId("timezone-select")).toBeInTheDocument();
    expect(screen.getByText(/current_time/)).toBeInTheDocument();
    expect(screen.queryByTestId("timezone-placeholder")).not.toBeInTheDocument();
  });
});
