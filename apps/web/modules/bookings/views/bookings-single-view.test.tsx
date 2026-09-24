import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TRPCClientError } from "@trpc/client";

import Success from "./bookings-single-view";
import type { PageProps } from "./bookings-single-view.getServerSideProps";

const mockShowToast = vi.fn();
vi.mock("@calcom/ui/components/toast", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => `t(${key})`, i18n: { language: "sl" } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/booking/booking-uid",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("@calcom/lib/hooks/useRouterQuery", () => ({
  useRouterQuery: () => ({ uid: "booking-uid" }),
}));

vi.mock("@calcom/lib/hooks/useCompatSearchParams", () => ({
  useCompatSearchParams: () => new URLSearchParams(),
}));

// The page renders far more than this test needs, so the mocked markHostAsNoShow hook keeps the options it is
// given and then stops the render there
const STOP_RENDER = new Error("stop render after markHostAsNoShow.useMutation");
let noShowOptions: { onError: (err: unknown) => void } | undefined;
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      public: {
        submitRating: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        markHostAsNoShow: {
          useMutation: (options: { onError: (err: unknown) => void }) => {
            noShowOptions = options;
            throw STOP_RENDER;
          },
        },
      },
    },
  },
}));

const props = {
  eventType: { recurringEvent: null, metadata: {}, title: "Intro", length: 30, users: [] },
  bookingInfo: {
    uid: "booking-uid",
    title: "Intro",
    status: "ACCEPTED",
    startTime: "2026-09-24T09:00:00.000Z",
    endTime: "2026-09-24T09:30:00.000Z",
    attendees: [{ name: "Booker", email: "booker@example.com", timeZone: "Europe/Ljubljana" }],
    responses: {},
    metadata: null,
    location: null,
    description: null,
  },
  tz: "Europe/Ljubljana",
} as unknown as PageProps;

const clientError = (code: string, httpStatus: number, message: string) =>
  TRPCClientError.from({ error: { message, code: -32000, data: { code, httpStatus } } });

// React (dev) rethrows a render error as a window error event; cancelling it keeps jsdom and React from
// logging the deliberate stop
const silenceStopRender = (event: ErrorEvent) => {
  if (event.error === STOP_RENDER) event.preventDefault();
};

describe("booking page: the host no-show error toast", () => {
  beforeEach(() => {
    mockShowToast.mockClear();
    noShowOptions = undefined;
    window.addEventListener("error", silenceStopRender);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Success {...props} />)).toThrow(STOP_RENDER);
    expect(noShowOptions).toBeDefined();
  });

  afterEach(() => {
    window.removeEventListener("error", silenceStopRender);
    vi.restoreAllMocks();
  });

  it("says a rate-limited report in the booker's language, not the server's English text", () => {
    noShowOptions?.onError(
      clientError("TOO_MANY_REQUESTS", 429, "Rate limit exceeded. Try again in 42 seconds.")
    );

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith("t(rate_limit_exceeded)", "error");
  });

  it("shows a generic error instead of the server's English refusal", () => {
    noShowOptions?.onError(clientError("BAD_REQUEST", 400, "Failed to update no-show status"));

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith("t(something_went_wrong)", "error");
  });
});
