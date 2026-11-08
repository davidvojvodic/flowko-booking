// Flowko U27: on the booking page a desk-only organizer's placeholder address is never shown as host e-mail, and a
// business (mirror) booking shows its stored title instead of one rebuilt from the mirror's "{Event type title}" template.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Success from "./bookings-single-view";
import type { PageProps } from "./bookings-single-view.getServerSideProps";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "sl" } }),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/booking/booking-uid",
  useSearchParams: () => new URLSearchParams(mocks.query),
  useParams: () => ({}),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("@calcom/lib/hooks/useRouterQuery", () => ({
  useRouterQuery: () => mocks.query,
}));

vi.mock("@calcom/lib/hooks/useCompatSearchParams", () => ({
  useCompatSearchParams: () => new URLSearchParams(mocks.query),
}));

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      public: {
        submitRating: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        markHostAsNoShow: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    },
  },
}));

vi.mock("@calcom/app-store/BookingPageTagManager", () => ({
  default: () => null,
}));

vi.mock("@calcom/web/components/booking/CancelBooking", () => ({
  default: () => <div data-testid="inline-cancel-form" />,
}));

const BOOKER_EMAIL = "booker@example.com";
const BUSINESS_NAME = "Salon Lepota";
const STORED_TITLE = "Barvanje med Ana in Marija Novak";

const baseProps = {
  eventType: {
    id: 1,
    title: BUSINESS_NAME,
    eventName: "{Event type title}",
    length: 30,
    isDynamic: false,
    recurringEvent: null,
    metadata: {},
    users: [],
    hosts: [],
    owner: null,
    team: null,
    bookingFields: [],
    requiresConfirmation: false,
    schedulingType: null,
    disableCancelling: false,
    disableRescheduling: false,
    allowReschedulingPastBookings: false,
    minimumRescheduleNotice: null,
    requiresCancellationReason: null,
  },
  bookingInfo: {
    id: 1,
    uid: "booking-uid",
    title: STORED_TITLE,
    status: "ACCEPTED",
    startTime: "2099-01-05T09:00:00.000Z",
    endTime: "2099-01-05T09:30:00.000Z",
    attendees: [
      {
        name: "Booker",
        email: BOOKER_EMAIL,
        timeZone: "Europe/Ljubljana",
        phoneNumber: null,
        isHost: false,
      },
    ],
    responses: { name: "Booker", email: BOOKER_EMAIL },
    metadata: null,
    location: null,
    description: null,
    user: { name: "Marija Novak", email: "desk-x@flowko.invalid" },
    userPrimaryEmail: null,
    seatsReferences: [],
    cancellationReason: null,
    rejectionReason: null,
    cancelledBy: null,
    rescheduled: false,
    eventType: null,
    tracking: null,
    assignmentReason: [],
  },
  profile: {
    name: "Host",
    slug: "host",
    theme: null,
    brandColor: null,
    darkBrandColor: null,
  },
  previousBooking: null,
  rescheduledToUid: null,
  requiresLoginToUpdate: false,
  recurringBookings: null,
  paymentStatus: null,
  isLoggedInUserHost: false,
  canViewHiddenData: false,
  internalNotePresets: [],
  hideBranding: true,
  tz: "Europe/Ljubljana",
  userTimeFormat: 24,
} as unknown as PageProps;

function withProps(patch: {
  user?: { name: string; email: string };
  userPrimaryEmail?: string | null;
  mirror?: boolean;
}): PageProps {
  return {
    ...baseProps,
    eventType: {
      ...baseProps.eventType,
      metadata: patch.mirror ? { flowkoMirror: true } : {},
    },
    bookingInfo: {
      ...baseProps.bookingInfo,
      ...(patch.user ? { user: patch.user } : {}),
      ...(patch.userPrimaryEmail !== undefined ? { userPrimaryEmail: patch.userPrimaryEmail } : {}),
    },
  } as unknown as PageProps;
}

async function renderPage(props: PageProps) {
  const view = render(<Success {...props} />);
  await waitFor(() => expect(screen.getByTestId("success-page")).toBeInTheDocument());
  return view;
}

describe("booking page: host e-mail (U27)", () => {
  beforeEach(() => {
    mocks.query = {
      uid: "booking-uid",
      isSuccessBookingPage: "true",
      email: BOOKER_EMAIL,
      eventTypeSlug: "x",
    };
  });

  it("shows no host address for a desk-only organizer", async () => {
    const { container } = await renderPage(withProps({}));
    expect(screen.getByTestId("booking-host-name")).toHaveTextContent("Marija Novak");
    expect(screen.queryByTestId("booking-host-email")).toBeNull();
    expect(container.innerHTML).not.toContain("flowko.invalid");
  });

  it("shows no host address when the primary e-mail is the desk placeholder", async () => {
    await renderPage(
      withProps({
        user: { name: "Marija Novak", email: "real@example.com" },
        userPrimaryEmail: "desk-x@flowko.invalid",
      })
    );
    expect(screen.queryByTestId("booking-host-email")).toBeNull();
  });

  it("still shows an ordinary host address", async () => {
    await renderPage(withProps({ user: { name: "Ana", email: "ana@example.com" } }));
    expect(screen.getByTestId("booking-host-email")).toHaveTextContent("ana@example.com");
  });
});

describe("booking page: salon title (U27)", () => {
  beforeEach(() => {
    mocks.query = {
      uid: "booking-uid",
      isSuccessBookingPage: "true",
      email: BOOKER_EMAIL,
      eventTypeSlug: "x",
    };
  });

  it("shows the stored title of a business booking, never the business name", async () => {
    await renderPage(withProps({ mirror: true }));
    expect(screen.getByTestId("booking-title")).toHaveTextContent(STORED_TITLE);
    expect(screen.getByTestId("booking-title")).not.toHaveTextContent(BUSINESS_NAME);
  });

  it("leaves an ordinary booking's title as built from the event type", async () => {
    await renderPage(withProps({}));
    expect(screen.getByTestId("booking-title")).toHaveTextContent(BUSINESS_NAME);
    expect(screen.getByTestId("booking-title")).not.toHaveTextContent(STORED_TITLE);
  });
});
