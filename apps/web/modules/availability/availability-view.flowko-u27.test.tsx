// Flowko U27: the "temporarily out of office / add a redirect" footer of the availability list is Cal's
// out-of-office screen; a non-owner business member does not get it.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AvailabilityList } from "./availability-view";

const mockHides = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoHidesCalScreens", () => ({
  useFlowkoHidesCalScreens: () => mockHides(),
}));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/lib/http-error", () => ({ HttpError: class extends Error {} }));

const mutation = { mutate: vi.fn(), isPending: false };
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({}),
    viewer: {
      availability: {
        schedule: {
          delete: { useMutation: () => mutation },
          update: { useMutation: () => mutation },
          duplicate: { useMutation: () => mutation },
          bulkUpdateToDefaultAvailability: { useMutation: () => mutation },
        },
      },
      eventTypes: { bulkEventFetch: { useQuery: () => ({ data: undefined, isFetching: false }) } },
    },
  },
}));
vi.mock("@calcom/trpc/react/hooks/useMeQuery", () => ({ default: () => ({ data: { timeFormat: 24 } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@formkit/auto-animate/react", () => ({ useAutoAnimate: () => [null] }));
vi.mock("app/(use-page-wrapper)/(main-nav)/availability/actions", () => ({
  revalidateAvailabilityList: vi.fn(),
}));
vi.mock("@calcom/web/modules/schedules/components/NewScheduleButton", () => ({
  NewScheduleButton: () => null,
}));
vi.mock("@calcom/features/schedules/components/ScheduleListItem", () => ({
  ScheduleListItem: () => <li>schedule</li>,
}));
vi.mock("@calcom/features/eventtypes/components/BulkEditDefaultForEventsModal", () => ({
  BulkEditDefaultForEventsModal: () => null,
}));
vi.mock("@calcom/ui/components/empty-screen", () => ({ EmptyScreen: () => null }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));

const availabilities = {
  schedules: [{ id: 1, name: "Working hours", isDefault: true }],
} as unknown as React.ComponentProps<typeof AvailabilityList>["availabilities"];

describe("AvailabilityList out-of-office footer (U27)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the redirect link to a user who is not hidden", () => {
    mockHides.mockReturnValue(false);
    const { container, getByText } = render(<AvailabilityList availabilities={availabilities} />);
    expect(getByText("temporarily_out_of_office", { exact: false })).toBeInTheDocument();
    expect(container.querySelector('a[href*="out-of-office"]')).not.toBeNull();
  });

  it("shows neither the text nor the link to a non-owner member", () => {
    mockHides.mockReturnValue(true);
    const { container, queryByText } = render(<AvailabilityList availabilities={availabilities} />);
    expect(queryByText("temporarily_out_of_office", { exact: false })).toBeNull();
    expect(container.querySelector('a[href*="out-of-office"]')).toBeNull();
    expect(queryByText("schedule")).not.toBeNull();
  });
});
