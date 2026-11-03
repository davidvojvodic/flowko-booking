import "@calcom/features/bookings/Booker/__mocks__/config";
import mockOverlayCalendar from "./__mocks__/OverlayCalendar";
import "./__mocks__/AvailableTimeSlots";
import "./__mocks__/DatePicker";
import "./__mocks__/DryRunMessage";
import "./__mocks__/EventMeta";
import "./__mocks__/LargeCalendar";
import "./__mocks__/Section";
import { constantsScenarios } from "@calcom/lib/__mocks__/constants";
import "@calcom/lib/__mocks__/logger";

import React from "react";
import { vi } from "vitest";

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    }),
    usePathname: () => "/test-path",
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
  };
});

import "@calcom/dayjs/__mocks__";
import "@calcom/web/modules/auth/components/Turnstile";

import { render } from "@calcom/features/bookings/Booker/__tests__/test-utils";
import type { BookerProps } from "@calcom/features/bookings/Booker/types";
import type { WrappedBookerProps } from "../types";
import { Booker } from "./Booker";

vi.mock("framer-motion", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
  };
});

// Mock components that we don't want to test
vi.mock("./BookEventForm", () => ({
  BookEventForm: ({
    isTimeslotUnavailable,
    onCancel,
  }: {
    isTimeslotUnavailable: boolean;
    onCancel: () => void;
  }) => {
    console.log("BookEventForm Called", { isTimeslotUnavailable, onCancel });
    return (
      <div data-testid="book-event-form" data-unavailable={isTimeslotUnavailable}>
        Mock Book Event Form
        <button onClick={onCancel}>cancel</button>
      </div>
    );
  },
}));

vi.mock("./BookEventForm/BookFormAsModal", () => ({
  BookFormAsModal: () => {
    return <div data-testid="book-form-as-modal">Mock Book Form As Modal</div>;
  },
}));

const mockEvent = {
  data: {
    id: 1,
    title: "Test Event",
    seatsPerTimeSlot: 1,
    seatsShowAvailabilityCount: true,
  },
  isSuccess: true,
  isPending: false,
};

vi.mock("@calcom/features/calendars/components/NoAvailabilityDialog", () => ({
  default: () => {
    return null;
  },
}));

const mockSchedule = {
  data: {
    slots: {
      "2024-01-01": [{ time: "2024-01-01T10:00:00Z" }, { time: "2024-01-01T11:00:00Z" }],
    },
  },
  isPending: false,
  invalidate: vi.fn(),
};

vi.mock("@calcom/atoms/hooks/useIsPlatformBookerEmbed", () => ({
  useIsPlatformBookerEmbed: () => false,
}));

vi.mock("@calcom/atoms/hooks/useIsPlatform", () => ({
  useIsPlatform: () => false,
}));

// Update defaultProps to include missing required props
const defaultProps = {
  username: "testuser",
  eventSlug: "test-event",
  entity: { considerUnpublished: false },
  event: mockEvent,
  schedule: mockSchedule,
  slots: {
    selectedTimeslot: "2024-01-01T10:00:00Z",
    setSelectedTimeslot: vi.fn(),
    allSelectedTimeslots: ["2024-01-01T10:00:00Z"],
    quickAvailabilityChecks: [],
  },
  bookerForm: {
    key: "form-key",
    bookerFormErrorRef: { current: null },
    formEmail: "",
    bookingForm: {
      watch: vi.fn(),
      setValue: vi.fn(),
      getValues: vi.fn().mockReturnValue({ responses: {} }),
    },
    errors: {},
  },
  bookings: {
    handleBookEvent: vi.fn(),
    errors: {},
    loadingStates: {},
  },
  verifyEmail: {
    isEmailVerificationModalVisible: false,
    setEmailVerificationModalVisible: vi.fn(),
    handleVerifyEmail: vi.fn(),
    renderConfirmNotVerifyEmailButtonCond: true,
    isVerificationCodeSending: false,
  },
  calendars: {
    overlayBusyDates: [],
    isOverlayCalendarEnabled: false,
    connectedCalendars: [],
    loadingConnectedCalendar: false,
    onToggleCalendar: vi.fn(),
  },
  bookerLayout: {
    shouldShowFormInDialog: false,
    extraDays: 7,
    columnViewExtraDays: { current: 7 },
    isMobile: false,
    layout: "MONTH_VIEW",
    hideEventTypeDetails: false,
    isEmbed: false,
    bookerLayouts: { enabledLayouts: [] },
    hasDarkBackground: false,
  },
  verifyCode: null,
  isPlatform: false,
  orgBannerUrl: null,
  customClassNames: {},
  userLocale: "en",
  hasValidLicense: true,
  isBookingDryRun: false,
  renderCaptcha: false,
  onOverlayClickNoCalendar: vi.fn(),
  onClickOverlayContinue: vi.fn(),
  onOverlaySwitchStateChange: vi.fn(),
  extraOptions: {},
  sessionUsername: null,
  rescheduleUid: null,
  hasSession: false,
};


// Flowko: render the overlay slot the real Header would render, so the test sees what Booker passes it.
vi.mock("@calcom/features/bookings/components/Header", () => ({
  Header: ({ renderOverlay }: { renderOverlay?: () => React.ReactNode }) => (
    <div data-testid="header">{renderOverlay?.()}</div>
  ),
}));

describe("Booker overlay calendar (Flowko: signed-in accounts only)", () => {
  beforeEach(() => {
    constantsScenarios.set({ PUBLIC_QUICK_AVAILABILITY_ROLLOUT: "100" });
    vi.clearAllMocks();
    // the shared mock returns a plain object; render nothing so the slot can mount
    mockOverlayCalendar.mockImplementation(() => null as never);
  });

  const renderWith = (overrides: Record<string, unknown>) =>
    render(<Booker {...({ ...defaultProps, ...overrides } as unknown as BookerProps & WrappedBookerProps)} />, {
      mockStore: { state: "selecting_time", selectedDate: "2024-01-01" },
    });

  it("hides „Prikaži moj koledar“ from a signed-out visitor", () => {
    renderWith({ hasSession: false });
    expect(mockOverlayCalendar).not.toHaveBeenCalled();
  });

  it("shows it to a signed-in account", () => {
    renderWith({ hasSession: true });
    expect(mockOverlayCalendar).toHaveBeenCalled();
  });

  it("never shows it in an embed", () => {
    renderWith({ hasSession: true, bookerLayout: { ...defaultProps.bookerLayout, isEmbed: true } });
    expect(mockOverlayCalendar).not.toHaveBeenCalled();
  });
});
