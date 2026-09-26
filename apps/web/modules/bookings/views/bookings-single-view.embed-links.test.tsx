import { render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEBAPP_URL } from "@calcom/lib/constants";

import Success, {
  getFirstPartyBookingUrl,
  getFirstPartyCancelUrl,
  getFirstPartyLoginUrl,
  getFirstPartyRescheduleUrl,
} from "./bookings-single-view";
import type { PageProps } from "./bookings-single-view.getServerSideProps";

// Flowko U13-11: inside an embed, Reschedule, Cancel, the login link and the previous/rescheduled booking links
// open the first-party pages on WEBAPP_URL in a new tab; outside an embed they are unchanged

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  routerReplace: vi.fn(),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "sl" } }),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: mocks.routerReplace, refresh: vi.fn() }),
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
        submitRating: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        markHostAsNoShow: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  },
}));

vi.mock("@calcom/app-store/BookingPageTagManager", () => ({ default: () => null }));

// The real form posts to /api/cancel; these tests only need to see whether the page renders it
vi.mock("@calcom/web/components/booking/CancelBooking", () => ({
  default: () => <div data-testid="inline-cancel-form" />,
}));

const BOOKER_EMAIL = "booker@example.com";

const baseProps = {
  eventType: {
    id: 1,
    title: "Intro",
    eventName: null,
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
    title: "Intro",
    status: "ACCEPTED",
    startTime: "2099-01-05T09:00:00.000Z",
    endTime: "2099-01-05T09:30:00.000Z",
    attendees: [
      { name: "Booker", email: BOOKER_EMAIL, timeZone: "Europe/Ljubljana", phoneNumber: null, isHost: false },
    ],
    responses: { name: "Booker", email: BOOKER_EMAIL },
    metadata: null,
    location: null,
    description: null,
    user: null,
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
  profile: { name: "Host", slug: "host", theme: null, brandColor: null, darkBrandColor: null },
  previousBooking: { uid: "previous-uid", rescheduledBy: "Host" },
  rescheduledToUid: "rescheduled-to-uid",
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

type SuccessProps = PageProps & { isEmbed?: boolean };

// The embed routes' server props carry isEmbed: true, and embed.js's iframe init makes window.isEmbed() true there
const realIsEmbed = window.isEmbed;
function setEmbedMode(isEmbed: boolean) {
  window.isEmbed = () => isEmbed;
}

// A link rendered by the page, found by its test id
const link = (testId: string) => screen.getByTestId(testId) as HTMLAnchorElement;

function expectFirstPartyNewTab(anchor: HTMLAnchorElement, href: string) {
  expect(anchor.tagName).toBe("A");
  expect(anchor.getAttribute("href")).toBe(href);
  expect(anchor.getAttribute("target")).toBe("_blank");
  expect(anchor.getAttribute("rel")?.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  expect(anchor.getAttribute("href")?.startsWith(`${WEBAPP_URL}/`)).toBe(true);
  // The booker's e-mail never goes into a URL that leaves the embed
  expect(decodeURIComponent(anchor.getAttribute("href") ?? "")).not.toContain(BOOKER_EMAIL);
}

// render() flushes the page's effects, including useIsEmbed's window.isEmbed() check
async function renderPage(props: SuccessProps) {
  const view = render(<Success {...props} />);
  await waitFor(() => expect(screen.getByTestId("success-page")).toBeInTheDocument());
  return view;
}

describe("booking success page links (U13-11)", () => {
  beforeEach(() => {
    mocks.query = {
      uid: "booking-uid",
      isSuccessBookingPage: "true",
      email: BOOKER_EMAIL,
      eventTypeSlug: "intro",
    };
    mocks.routerReplace.mockClear();
  });

  afterEach(() => {
    window.isEmbed = realIsEmbed;
    vi.restoreAllMocks();
  });

  it("uses a real absolute WEBAPP_URL in the test environment", () => {
    expect(WEBAPP_URL).toMatch(/^https?:\/\//);
  });

  describe("inside an embed", () => {
    beforeEach(() => setEmbedMode(true));

    it("opens Reschedule, Cancel and the previous/rescheduled booking on the first-party site in a new tab", async () => {
      await renderPage({ ...baseProps, isEmbed: true });

      expectFirstPartyNewTab(link("reschedule-link"), `${WEBAPP_URL}/reschedule/booking-uid`);
      expectFirstPartyNewTab(link("cancel"), `${WEBAPP_URL}/booking/booking-uid?cancel=true`);
      expectFirstPartyNewTab(link("original-booking-link"), `${WEBAPP_URL}/booking/previous-uid`);
      expectFirstPartyNewTab(link("rescheduled-booking-link"), `${WEBAPP_URL}/booking/rescheduled-to-uid`);
    });

    it("keeps a seat's reference and a series' cancel scope, and leaves rescheduledBy/cancelledBy out", async () => {
      mocks.query = {
        ...mocks.query,
        seatReferenceUid: "seat-ref",
        allRemainingBookings: "true",
        rescheduledBy: BOOKER_EMAIL,
        cancelledBy: BOOKER_EMAIL,
      };
      await renderPage({
        ...baseProps,
        bookingInfo: { ...baseProps.bookingInfo, seatsReferences: [{ referenceUid: "seat-ref" }] },
        isEmbed: true,
      } as SuccessProps);

      expectFirstPartyNewTab(link("reschedule-link"), `${WEBAPP_URL}/reschedule/seat-ref`);
      expectFirstPartyNewTab(
        link("cancel"),
        `${WEBAPP_URL}/booking/booking-uid?cancel=true&allRemainingBookings=true&seatReferenceUid=seat-ref`
      );
    });

    it("never renders the inline cancel form, even when the embed is opened with ?cancel=true", async () => {
      mocks.query = { ...mocks.query, cancel: "true" };
      await renderPage({ ...baseProps, isEmbed: true });

      expect(screen.queryByTestId("inline-cancel-form")).not.toBeInTheDocument();
      expectFirstPartyNewTab(link("cancel"), `${WEBAPP_URL}/booking/booking-uid?cancel=true`);
    });

    it("renders Cancel as a link, so clicking it doesn't switch the iframe into cancel mode", async () => {
      await renderPage({ ...baseProps, isEmbed: true });

      link("cancel").click();

      expect(mocks.routerReplace).not.toHaveBeenCalled();
      expect(screen.queryByTestId("inline-cancel-form")).not.toBeInTheDocument();
    });

    it("is embedded from the server render on, before the page's embed check runs in the browser", () => {
      // No effects run on the server, so only the /embed route's isEmbed prop can make this markup embedded
      mocks.query = { ...mocks.query, cancel: "true" };
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(<Success {...baseProps} isEmbed />);

      expect(container.querySelector('[data-testid="inline-cancel-form"]')).toBeNull();
      const cancel = container.querySelector('[data-testid="cancel"]') as HTMLAnchorElement;
      expectFirstPartyNewTab(cancel, `${WEBAPP_URL}/booking/booking-uid?cancel=true`);
      const reschedule = container.querySelector('[data-testid="reschedule-link"]') as HTMLAnchorElement;
      expectFirstPartyNewTab(reschedule, `${WEBAPP_URL}/reschedule/booking-uid`);
    });

    it("opens the seat holder's login on the first-party site in a new tab", async () => {
      await renderPage({ ...baseProps, requiresLoginToUpdate: true, isEmbed: true } as SuccessProps);

      expectFirstPartyNewTab(link("reschedule-link"), getFirstPartyLoginUrl("booking-uid"));
      expect(link("reschedule-link").getAttribute("href")).toBe(
        `${WEBAPP_URL}/auth/login?callbackUrl=%2Fbooking%2Fbooking-uid`
      );
    });
  });

  describe("outside an embed", () => {
    beforeEach(() => setEmbedMode(false));

    it("keeps the relative same-tab links and the Cancel button", async () => {
      await renderPage(baseProps);

      const reschedule = link("reschedule-link");
      expect(reschedule.getAttribute("href")).toBe("/reschedule/booking-uid");
      expect(reschedule.getAttribute("target")).toBeNull();

      const original = screen.getByText("original_booking").closest("a") as HTMLAnchorElement;
      expect(original.getAttribute("href")).toBe("/booking/previous-uid");
      expect(original.getAttribute("target")).toBeNull();

      const rescheduledTo = screen.getByText("view_booking").closest("a") as HTMLAnchorElement;
      expect(rescheduledTo.getAttribute("href")).toBe("/booking/rescheduled-to-uid");
      expect(rescheduledTo.getAttribute("target")).toBeNull();

      expect(screen.queryByTestId("original-booking-link")).not.toBeInTheDocument();
      expect(screen.queryByTestId("rescheduled-booking-link")).not.toBeInTheDocument();
    });

    it("still switches the page into its own cancel form", async () => {
      await renderPage(baseProps);

      const cancel = screen.getByTestId("cancel");
      expect(cancel.tagName).toBe("BUTTON");
      cancel.click();

      expect(mocks.routerReplace).toHaveBeenCalledTimes(1);
      const [target] = mocks.routerReplace.mock.calls[0] as [string];
      expect(target.startsWith("/booking/booking-uid?")).toBe(true);
      expect(new URLSearchParams(target.split("?")[1]).get("cancel")).toBe("true");
    });

    it("renders the inline cancel form with ?cancel=true", async () => {
      mocks.query = { ...mocks.query, cancel: "true" };
      await renderPage(baseProps);

      expect(screen.getByTestId("inline-cancel-form")).toBeInTheDocument();
      expect(screen.queryByTestId("cancel")).not.toBeInTheDocument();
    });

    it("passes rescheduledBy on to the reschedule link as before", async () => {
      mocks.query = { ...mocks.query, rescheduledBy: BOOKER_EMAIL };
      await renderPage(baseProps);

      expect(link("reschedule-link").getAttribute("href")).toBe(
        `/reschedule/booking-uid?rescheduledBy=${encodeURIComponent(BOOKER_EMAIL)}`
      );
    });
  });
});

describe("first-party URL builders (U13-11)", () => {
  it("builds absolute URLs on WEBAPP_URL", () => {
    expect(getFirstPartyBookingUrl("abc")).toBe(`${WEBAPP_URL}/booking/abc`);
    expect(getFirstPartyRescheduleUrl({ uid: "abc" })).toBe(`${WEBAPP_URL}/reschedule/abc`);
    expect(getFirstPartyRescheduleUrl({ uid: "abc", seatReferenceUid: "seat" })).toBe(
      `${WEBAPP_URL}/reschedule/seat`
    );
    expect(getFirstPartyCancelUrl({ uid: "abc" })).toBe(`${WEBAPP_URL}/booking/abc?cancel=true`);
    expect(getFirstPartyCancelUrl({ uid: "abc", allRemainingBookings: false })).toBe(
      `${WEBAPP_URL}/booking/abc?cancel=true`
    );
  });

  it("keeps a uid or seat reference from the embed URL inside its path segment", () => {
    expect(getFirstPartyBookingUrl("../settings/admin")).toBe(`${WEBAPP_URL}/booking/..%2Fsettings%2Fadmin`);
    expect(getFirstPartyRescheduleUrl({ uid: "abc", seatReferenceUid: "../../auth/logout" })).toBe(
      `${WEBAPP_URL}/reschedule/..%2F..%2Fauth%2Flogout`
    );
    expect(getFirstPartyCancelUrl({ uid: "abc", seatReferenceUid: "a&cancelledBy=x" })).toBe(
      `${WEBAPP_URL}/booking/abc?cancel=true&seatReferenceUid=a%26cancelledBy%3Dx`
    );
  });
});
