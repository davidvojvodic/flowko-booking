import { describe, it, expect, vi, beforeEach, test } from "vitest";

import { useIsEmbed } from "@calcom/embed-core/embed-iframe";
import { useCompatSearchParams } from "@calcom/lib/hooks/useCompatSearchParams";
import { navigateInTopWindow } from "@calcom/lib/navigateInTopWindow";

import { useBookingSuccessRedirect, getNewSearchParams } from "./bookingSuccessRedirect";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@calcom/lib/navigateInTopWindow", () => ({
  navigateInTopWindow: vi.fn(),
}));

vi.mock("@calcom/lib/hooks/useCompatSearchParams", () => ({
  useCompatSearchParams: vi.fn(),
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useIsEmbed: vi.fn(),
}));

// Test data constants
const EMBED_PARAMS = ["embed", "layout", "embedType", "ui.color-scheme"];
const WEBAPP_PARAMS = ["overlayCalendar"];

// Helper function to create a mock booking with sensible defaults
type MockBooking = Pick<
  BookingResponse,
  "uid" | "title" | "description" | "startTime" | "endTime" | "location" | "attendees" | "user" | "responses"
>;

const createMockBooking = (overrides: Partial<MockBooking> = {}): MockBooking => ({
  uid: "test-booking-uid",
  title: "Test Meeting",
  description: "Test Description",
  startTime: new Date("2024-01-01T10:00:00Z"),
  endTime: new Date("2024-01-01T11:00:00Z"),
  location: "Zoom",
  attendees: [
    {
      id: 1,
      name: "John Doe",
      email: "john@example.com",
      timeZone: "UTC",
      locale: "en",
      phoneNumber: "+1234567890",
      bookingId: 1,
      noShow: false,
    },
  ],
  user: {
    email: null,
    name: "Jane Host",
    timeZone: "UTC",
    username: "jane-host",
  },
  responses: {
    name: "John Doe",
    phone: "+1234567890",
  },
  ...overrides,
});

// Helper to assert multiple params are null
const assertParamsNull = (result: URLSearchParams, params: string[]) => {
  params.forEach((param) => expect(result.get(param)).toBeNull());
};

// Helper to assert multiple params have specific values
const assertParamsEqual = (result: URLSearchParams, paramValues: Record<string, string>) => {
  Object.entries(paramValues).forEach(([key, value]) => {
    expect(result.get(key)).toBe(value);
  });
};

// Helper to assert URL search params
const assertUrlSearchParams = (url: string, expectedParams: Record<string, string | null>) => {
  const urlObject = new URL(url);
  Object.entries(expectedParams).forEach(([key, value]) => {
    if (value === null) {
      expect(urlObject.searchParams.get(key)).toBeNull();
    } else {
      expect(urlObject.searchParams.get(key)).toBe(value);
    }
  });
};

describe("getNewSearchParams", () => {
  describe("filtering internal params", () => {
    describe("when filterInternalParams is true", () => {
      test.each([
        {
          name: "filters embed params from searchParams",
          searchParams: {
            embed: "true",
            layout: "month_view",
            embedType: "inline",
            "ui.color-scheme": "dark",
            foo: "bar",
          },
          query: { bookingId: "123" },
          expectedNull: ["embed", "layout", "embedType", "ui.color-scheme"],
          expectedPresent: { foo: "bar", bookingId: "123" },
        },
        {
          name: "filters webapp params from searchParams",
          searchParams: { overlayCalendar: "true", foo: "bar" },
          query: { bookingId: "123" },
          expectedNull: ["overlayCalendar"],
          expectedPresent: { foo: "bar", bookingId: "123" },
        },
        {
          name: "filters both embed and webapp params from searchParams",
          searchParams: { embed: "true", layout: "month_view", overlayCalendar: "true", foo: "bar" },
          query: { bookingId: "123" },
          expectedNull: ["embed", "layout", "overlayCalendar"],
          expectedPresent: { foo: "bar", bookingId: "123" },
        },
      ])("$name", ({ searchParams, query, expectedNull, expectedPresent }) => {
        const result = getNewSearchParams({
          query,
          searchParams: new URLSearchParams(searchParams),
          filterInternalParams: true,
        });

        assertParamsNull(result, expectedNull);
        assertParamsEqual(result, expectedPresent);
      });

      test.each([
        {
          name: "filters embed params from query object",
          query: {
            bookingId: "789",
            embed: "namespace",
            layout: "month_view",
            embedType: "inline",
            "ui.color-scheme": "dark",
            test: "value",
          },
          expectedNull: ["embed", "layout", "embedType", "ui.color-scheme"],
          expectedPresent: { bookingId: "789", test: "value" },
        },
        {
          name: "filters webapp params from query object",
          query: {
            bookingId: "789",
            overlayCalendar: "true",
            test: "value",
          },
          expectedNull: ["overlayCalendar"],
          expectedPresent: { bookingId: "789", test: "value" },
        },
      ])("$name", ({ query, expectedNull, expectedPresent }) => {
        const result = getNewSearchParams({ query, filterInternalParams: true });

        assertParamsNull(result, expectedNull);
        assertParamsEqual(result, expectedPresent);
      });
    });

    describe("when filterInternalParams is false", () => {
      test.each([
        {
          name: "preserves embed params",
          searchParams: { embed: "true", layout: "month_view", foo: "bar" },
          query: { bookingId: "456" },
          expectedPresent: { embed: "true", layout: "month_view", foo: "bar", bookingId: "456" },
        },
        {
          name: "preserves webapp params",
          searchParams: { overlayCalendar: "true", foo: "bar" },
          query: { bookingId: "456" },
          expectedPresent: { overlayCalendar: "true", foo: "bar", bookingId: "456" },
        },
      ])("$name", ({ searchParams, query, expectedPresent }) => {
        const result = getNewSearchParams({
          query,
          searchParams: new URLSearchParams(searchParams),
          filterInternalParams: false,
        });

        assertParamsEqual(result, expectedPresent);
      });
    });

    describe("when filterInternalParams is not provided", () => {
      it("defaults to false and preserves all params", () => {
        const searchParams = new URLSearchParams({
          embed: "true",
          overlayCalendar: "true",
          foo: "bar",
        });
        const query = { bookingId: "123" };

        const result = getNewSearchParams({ query, searchParams });

        assertParamsEqual(result, {
          embed: "true",
          overlayCalendar: "true",
          foo: "bar",
          bookingId: "123",
        });
      });
    });
  });

  describe("edge cases", () => {
    it("handles null values in query", () => {
      const query = {
        bookingId: "123",
        nullParam: null,
        undefinedParam: undefined,
        validParam: "value",
      };

      const result = getNewSearchParams({ query });

      expect(result.get("bookingId")).toBe("123");
      expect(result.get("nullParam")).toBeNull();
      expect(result.get("undefinedParam")).toBeNull();
      expect(result.get("validParam")).toBe("value");
    });

    it("handles empty strings in query", () => {
      const query = {
        emptyString: "",
        bookingId: "123",
      };

      const result = getNewSearchParams({ query });

      expect(result.get("emptyString")).toBe("");
      expect(result.get("bookingId")).toBe("123");
    });

    it("handles boolean values in query", () => {
      const query = {
        boolTrue: true,
        boolFalse: false,
      };

      const result = getNewSearchParams({ query });

      expect(result.get("boolTrue")).toBe("true");
      expect(result.get("boolFalse")).toBe("false");
    });

    it("handles missing searchParams", () => {
      const query = { bookingId: "123", test: "value" };

      const result = getNewSearchParams({ query, filterInternalParams: true });

      assertParamsEqual(result, { bookingId: "123", test: "value" });
    });

    it("handles empty query object", () => {
      const searchParams = new URLSearchParams({ foo: "bar" });

      const result = getNewSearchParams({ query: {}, searchParams });

      assertParamsEqual(result, { foo: "bar" });
    });

    it("query params are appended after searchParams when keys conflict", () => {
      const searchParams = new URLSearchParams({ shared: "fromSearchParams", foo: "bar" });
      const query = { shared: "fromQuery", baz: "qux" };

      const result = getNewSearchParams({ query, searchParams });

      // When using append, both values are kept with the first one returned by get()
      expect(result.get("shared")).toBe("fromSearchParams");
      expect(result.getAll("shared")).toEqual(["fromSearchParams", "fromQuery"]);
      expect(result.get("foo")).toBe("bar");
      expect(result.get("baz")).toBe("qux");
    });
  });
});

describe("useBookingSuccessRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCompatSearchParams).mockReturnValue(new URLSearchParams() as any);
    vi.mocked(useIsEmbed).mockReturnValue(false);
  });

  const mockBooking = createMockBooking();

  describe("external redirects", () => {
    describe("without forwardParamsSuccessRedirect", () => {
      it("redirects to external URL without any parameters", () => {
        const bookingSuccessRedirect = useBookingSuccessRedirect();

        bookingSuccessRedirect({
          successRedirectUrl: "https://example.com/success",
          forwardParamsSuccessRedirect: false,
          query: { test: "value", embed: "namespace" },
          booking: mockBooking,
        });

        expect(navigateInTopWindow).toHaveBeenCalledWith("https://example.com/success");
      });
    });

    // Flowko U13-20: forwardParamsSuccessRedirect has no effect, so nothing about the booking or the booker is ever
    // appended to a redirect URL, for event types saved with forwarding on before the handlers refused redirects
    describe("with forwardParamsSuccessRedirect", () => {
      it("redirects to the saved URL without the booking, the booker's details or the page's query", () => {
        vi.mocked(useCompatSearchParams).mockReturnValue(
          new URLSearchParams(
            "name=Ana+Novak&email=ana%40example.com&guests=guest%40example.com&metadata[x]=1&cal.rerouting=true&embed=ns"
          ) as any
        );
        vi.mocked(useIsEmbed).mockReturnValue(true);

        const bookingSuccessRedirect = useBookingSuccessRedirect();

        bookingSuccessRedirect({
          successRedirectUrl: "https://example.com/success?campaign=autumn",
          forwardParamsSuccessRedirect: true,
          query: {
            isSuccessBookingPage: true,
            email: "ana@example.com",
            eventTypeSlug: "pregled",
            seatReferenceUid: "seat-reference-uid",
            rescheduledBy: "ana@example.com",
          },
          booking: mockBooking,
        });

        expect(navigateInTopWindow).toHaveBeenCalledTimes(1);
        expect(navigateInTopWindow).toHaveBeenCalledWith("https://example.com/success?campaign=autumn");
        const calledUrl = vi.mocked(navigateInTopWindow).mock.calls[0][0];
        expect(calledUrl).not.toContain("test-booking-uid");
        expect(calledUrl).not.toContain("%40");
        expect(calledUrl).not.toContain("John");
        expect(calledUrl).not.toContain("1234567890");
        expect(mockPush).not.toHaveBeenCalled();
      });

      it.each(["javascript:alert(document.domain)", "data:text/html,<p>x</p>", "   ", "not a url"])(
        "shows the booking success page instead of following %s",
        (successRedirectUrl) => {
          const bookingSuccessRedirect = useBookingSuccessRedirect();

          bookingSuccessRedirect({
            successRedirectUrl,
            forwardParamsSuccessRedirect: false,
            query: { email: "ana@example.com" },
            booking: mockBooking,
          });

          expect(navigateInTopWindow).not.toHaveBeenCalled();
          expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/booking/test-booking-uid?"));
        }
      );

      it("treats a missing forwardParamsSuccessRedirect (upstream's default of true) the same way", () => {
        const bookingSuccessRedirect = useBookingSuccessRedirect();

        bookingSuccessRedirect({
          successRedirectUrl: "https://example.com/success",
          forwardParamsSuccessRedirect: null,
          query: { email: "ana@example.com" },
          booking: mockBooking,
        });

        expect(navigateInTopWindow).toHaveBeenCalledWith("https://example.com/success");
      });
    });
  });

  describe("internal redirects to booking page", () => {
    describe("URL structure", () => {
      test.each([
        { isEmbed: false, expectedPath: "/booking/test-booking-uid?" },
        { isEmbed: true, expectedPath: "/booking/test-booking-uid/embed?" },
      ])("redirects to $expectedPath when isEmbed is $isEmbed", ({ isEmbed, expectedPath }) => {
        vi.mocked(useIsEmbed).mockReturnValue(isEmbed);

        const bookingSuccessRedirect = useBookingSuccessRedirect();

        bookingSuccessRedirect({
          successRedirectUrl: null,
          forwardParamsSuccessRedirect: false,
          query: { test: "value" },
          booking: mockBooking,
        });

        expect(mockPush).toHaveBeenCalledWith(expect.stringContaining(expectedPath));
      });
    });

    describe("param preservation for internal navigation", () => {
      it("preserves ALL params including embed and webapp params (no filtering)", () => {
        vi.mocked(useIsEmbed).mockReturnValue(false);

        const bookingSuccessRedirect = useBookingSuccessRedirect();

        bookingSuccessRedirect({
          successRedirectUrl: null,
          forwardParamsSuccessRedirect: false,
          query: {
            test: "value",
            embed: "namespace",
            layout: "month_view",
            embedType: "inline",
            "ui.color-scheme": "dark",
            overlayCalendar: "true",
          },
          booking: mockBooking,
        });

        const calledUrl = mockPush.mock.calls[0][0];

        // ALL params should be preserved for internal navigation
        expect(calledUrl).toContain("test=value");
        expect(calledUrl).toContain("embed=namespace");
        expect(calledUrl).toContain("layout=month_view");
        expect(calledUrl).toContain("embedType=inline");
        expect(calledUrl).toContain("ui.color-scheme=dark");
        expect(calledUrl).toContain("overlayCalendar=true");
      });

      test.each([
        {
          name: "includes flag.coep from searchParams",
          searchParams: "flag.coep=true",
          expectedParam: "flag.coep=true",
        },
        {
          name: "includes cal.rerouting from searchParams",
          searchParams: "cal.rerouting=true",
          expectedParam: "cal.rerouting=true",
        },
      ])("$name", ({ searchParams, expectedParam }) => {
        vi.mocked(useCompatSearchParams).mockReturnValue(new URLSearchParams(searchParams) as any);

        const bookingSuccessRedirect = useBookingSuccessRedirect();

        bookingSuccessRedirect({
          successRedirectUrl: null,
          forwardParamsSuccessRedirect: false,
          query: { test: "value" },
          booking: mockBooking,
        });

        const calledUrl = mockPush.mock.calls[0][0];
        expect(calledUrl).toContain(expectedParam);
      });
    });
  });

  describe("edge cases", () => {
    it("handles null successRedirectUrl correctly", () => {
      const bookingSuccessRedirect = useBookingSuccessRedirect();

      bookingSuccessRedirect({
        successRedirectUrl: null,
        forwardParamsSuccessRedirect: true,
        query: { test: "value" },
        booking: mockBooking,
      });

      expect(mockPush).toHaveBeenCalled();
      expect(navigateInTopWindow).not.toHaveBeenCalled();
    });

    it("handles undefined successRedirectUrl correctly", () => {
      const bookingSuccessRedirect = useBookingSuccessRedirect();

      bookingSuccessRedirect({
        successRedirectUrl: undefined as any,
        forwardParamsSuccessRedirect: true,
        query: { test: "value" },
        booking: mockBooking,
      });

      expect(mockPush).toHaveBeenCalled();
      expect(navigateInTopWindow).not.toHaveBeenCalled();
    });

    it("handles empty query object", () => {
      const bookingSuccessRedirect = useBookingSuccessRedirect();

      bookingSuccessRedirect({
        successRedirectUrl: "https://example.com/success",
        forwardParamsSuccessRedirect: false,
        query: {},
        booking: mockBooking,
      });

      expect(navigateInTopWindow).toHaveBeenCalledWith("https://example.com/success");
    });
  });
});
