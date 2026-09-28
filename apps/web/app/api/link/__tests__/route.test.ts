import { LINK_TOKEN_KEY_LABEL, symmetricEncrypt, symmetricEncryptAuthenticated } from "@calcom/lib/crypto";
import { BookingStatus } from "@calcom/prisma/enums";
import { confirmHandler } from "@calcom/trpc/server/routers/viewer/bookings/confirm.handler";
import type { NextRequest } from "next/server";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirmHandler = confirmHandler as unknown as Mock<typeof confirmHandler>;

vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir:
    (handler: (req: NextRequest) => Promise<Response>) =>
    (req: NextRequest, _context: { params: Promise<Record<string, string>> }) =>
      handler(req),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));

// NextResponse.redirect(url, init): init is a status number or a ResponseInit; Next's own default is 307.
vi.mock("next/server", () => ({
  NextResponse: {
    redirect: vi.fn((url: string | URL, init?: number | { status?: number }) => {
      const location = typeof url === "string" ? url : url.toString();
      return {
        status: typeof init === "number" ? init : (init?.status ?? 307),
        headers: {
          get: (name: string) => (name.toLowerCase() === "location" ? location : null),
        },
      } as unknown as Response;
    }),
  },
}));

// Two tenants: booking-a belongs to user 1 (organizer A), booking-b to user 2 (organizer B). All wait for the
// organizer's decision; U8e tests change their status.
type BookingRow = {
  id: number;
  uid: string;
  userId: number | null;
  recurringEventId: string | null;
  status: BookingStatus;
  title: string;
  startTime: Date;
  endTime: Date;
};
const booking = (row: Omit<BookingRow, "title" | "startTime" | "endTime">): BookingRow => ({
  ...row,
  title: `Ogled ${row.uid}`,
  startTime: new Date("2026-10-05T08:00:00Z"),
  endTime: new Date("2026-10-05T08:30:00Z"),
});
const INITIAL_BOOKINGS: Record<string, BookingRow> = {
  "booking-a": booking({
    id: 11,
    uid: "booking-a",
    userId: 1,
    recurringEventId: null,
    status: BookingStatus.PENDING,
  }),
  "booking-b": booking({
    id: 22,
    uid: "booking-b",
    userId: 2,
    recurringEventId: null,
    status: BookingStatus.PENDING,
  }),
  "booking-orphan": booking({
    id: 33,
    uid: "booking-orphan",
    userId: null,
    recurringEventId: null,
    status: BookingStatus.PENDING,
  }),
};
let BOOKINGS: Record<string, BookingRow> = {};
const USERS: Record<number, Record<string, unknown>> = {
  1: {
    id: 1,
    uuid: "user-a-uuid",
    email: "a@example.com",
    username: "organizer-a",
    role: "USER",
    destinationCalendar: null,
    locale: "sl",
    timeZone: "Europe/Ljubljana",
    timeFormat: 24,
  },
  2: {
    id: 2,
    uuid: "user-b-uuid",
    email: "b@example.com",
    username: "organizer-b",
    role: "USER",
    destinationCalendar: null,
    locale: "en",
    timeZone: "Europe/London",
    timeFormat: 12,
  },
};

vi.mock("@calcom/prisma", () => {
  const mockPrismaObj = {
    booking: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };
  return {
    default: mockPrismaObj,
    prisma: mockPrismaObj,
  };
});

vi.mock("@calcom/trpc/server/routers/viewer/bookings/confirm.handler", () => ({
  confirmHandler: vi.fn(),
}));

vi.mock("@calcom/lib/tracing/factory", () => ({
  distributedTracing: {
    createTrace: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("@calcom/features/booking-audit/lib/makeActor", () => ({
  makeUserActor: vi.fn().mockReturnValue({ type: "user", id: "test-uuid" }),
}));

import prisma from "@calcom/prisma";
// Import after mocks are set up
import { GET, POST } from "../route";

const TEST_KEY = "abcdefghjnmkljhjklmnhjklkmnbhjui"; // 32 bytes, like CALENDSO_ENCRYPTION_KEY

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A token exactly as OrganizerRequestEmail issues it. */
const makeToken = (payload: Record<string, unknown>) =>
  symmetricEncryptAuthenticated(JSON.stringify(payload), TEST_KEY, LINK_TOKEN_KEY_LABEL);

const validToken = (overrides: Record<string, unknown> = {}) =>
  makeToken({ bookingUid: "booking-a", userId: 1, iat: nowSeconds(), ...overrides });

const linkUrl = (origin: string, params: Record<string, string> = {}) => {
  const query = new URLSearchParams(params).toString();
  return `${origin}/api/link${query ? `?${query}` : ""}`;
};

const DEFAULT_ORIGIN = "https://app.example.com";
const noParams = { params: Promise.resolve({}) };

/** The e-mailed link as a mail scanner or the organizer's browser opens it. */
const getLink = async (params: Record<string, string>, origin = DEFAULT_ORIGIN) => {
  const url = linkUrl(origin, params);
  const request = {
    method: "GET",
    url,
    headers: new Headers(),
    nextUrl: { searchParams: new URL(url).searchParams },
  } as unknown as NextRequest;
  return GET(request, noParams);
};

/** The confirm page's form (application/x-www-form-urlencoded), or a JSON body. */
const postLink = async (
  body: Record<string, string> | string,
  {
    origin = DEFAULT_ORIGIN,
    query = {},
    contentType = "application/x-www-form-urlencoded",
  }: { origin?: string; query?: Record<string, string>; contentType?: string } = {}
) => {
  const url = linkUrl(origin, query);
  const payload =
    typeof body === "string"
      ? body
      : contentType.includes("json")
        ? JSON.stringify(body)
        : new URLSearchParams(body).toString();
  const request = Object.assign(
    new Request(url, { method: "POST", headers: { "content-type": contentType }, body: payload }),
    { nextUrl: new URL(url) }
  ) as unknown as NextRequest;
  return POST(request, noParams);
};

// Vitest sets NEXT_PUBLIC_WEBAPP_URL to http://app.cal.local:3000 (see vitest.config.mts)
const EXPECTED_REDIRECT_ORIGIN = "http://app.cal.local:3000";
const CONFIRM_PAGE = `${EXPECTED_REDIRECT_ORIGIN}/booking/link`;
// Flowko (U8f): an invalid link opens the confirm page without a token, which says the link is not valid.
const INVALID_LINK_LOCATION = CONFIRM_PAGE;
const BOOKING_PAGE = `${EXPECTED_REDIRECT_ORIGIN}/booking/booking-a`;

const responseShape = (res: Response) => ({ status: res.status, location: res.headers.get("location") });

const confirmPageFor = (token: string, action: string) =>
  `${CONFIRM_PAGE}?${new URLSearchParams({ token, action }).toString()}`;

describe("link route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", TEST_KEY);
    BOOKINGS = Object.fromEntries(Object.entries(INITIAL_BOOKINGS).map(([uid, row]) => [uid, { ...row }]));
    mockConfirmHandler.mockReset();
    // By uid: the link's lookup. By id: the POST's second read of the status inside its per-booking slot.
    vi.mocked(prisma.booking.findUnique).mockImplementation((async (args: {
      where: { uid?: string; id?: number };
    }) =>
      args.where.uid !== undefined
        ? (BOOKINGS[args.where.uid] ?? null)
        : (Object.values(BOOKINGS).find((row) => row.id === args.where.id) ?? null)) as never);
    vi.mocked(prisma.user.findUnique).mockImplementation(
      (async (args: { where: { id: number } }) => USERS[args.where.id] ?? null) as never
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  // Flowko (U8f, David 2026-09-28): mail scanners (Outlook Safe Links, Mimecast, Proofpoint) open every link
  // in an e-mail. The link's GET only opens the confirm page; only the page's button (a POST) decides.
  describe("U8f - a GET never decides", () => {
    const expectNothingDecided = () => {
      expect(mockConfirmHandler).not.toHaveBeenCalled();
      expect(prisma.booking.update).not.toHaveBeenCalled();
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      expect(BOOKINGS["booking-a"].status).toBe(BookingStatus.PENDING);
    };

    it.each([
      "accept",
      "reject",
    ])("opens the confirm page for %s without calling the confirm handler", async (action) => {
      const token = validToken();
      const res = await getLink({ token, action });

      expect(responseShape(res)).toEqual({ status: 303, location: confirmPageFor(token, action) });
      expectNothingDecided();
    });

    it("changes nothing however often the link is opened (a scanner's prefetch, a preview, a reload)", async () => {
      const token = validToken();
      for (let i = 0; i < 5; i++) {
        await getLink({ action: "accept", token });
        await getLink({ action: "reject", token });
      }
      expectNothingDecided();
    });

    it("does not act on a reason in the query either", async () => {
      await getLink({ action: "reject", token: validToken(), reason: "scanner" });
      expectNothingDecided();
    });

    it("checks the link as the POST does: it reads the booking and its organizer, and writes nothing", async () => {
      await getLink({ action: "accept", token: validToken() });

      expect(prisma.booking.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { uid: "booking-a" } })
      );
      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
      expectNothingDecided();
    });

    it("passes on only the token and the action, never other query params", async () => {
      const token = validToken();
      const res = await getLink({
        action: "accept",
        token,
        bookingUid: "booking-b",
        userId: "2",
        reason: "x",
      });

      expect(res.headers.get("location")).toBe(confirmPageFor(token, "accept"));
    });

    it("opens the confirm page for a booking that no longer waits, which then says so", async () => {
      BOOKINGS["booking-a"].status = BookingStatus.REJECTED;
      const token = validToken();
      const res = await getLink({ action: "accept", token });

      expect(responseShape(res)).toEqual({ status: 303, location: confirmPageFor(token, "accept") });
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("redirects on WEBAPP_URL whatever origin the request came in on", async () => {
      for (const origin of [
        "https://app.cal.com",
        "https://calcom.company.internal",
        "http://192.168.1.100:3000",
      ]) {
        const res = await getLink({ action: "accept", token: validToken() }, origin);
        expect(new URL(res.headers.get("location")!).origin).toBe(EXPECTED_REDIRECT_ORIGIN);
      }
    });

    it("answers every invalid link the same way, without the token and without acting", async () => {
      const cases: Record<string, string>[] = [
        { action: "accept", token: `${"00".repeat(16)}:${"11".repeat(32)}` },
        { action: "accept", token: symmetricEncrypt("not json", TEST_KEY) },
        {
          action: "accept",
          token: symmetricEncryptAuthenticated("not json", TEST_KEY, LINK_TOKEN_KEY_LABEL),
        },
        { action: "accept", token: makeToken({ bookingUid: 123, userId: "1", iat: nowSeconds() }) },
        { action: "accept", token: "%E0%A4%A" },
        { action: "accept", token: "" },
        { action: "accept" },
        { action: "approve", token: validToken() },
        { action: "accept", token: makeToken({ bookingUid: "no-such", userId: 1, iat: nowSeconds() }) },
        { action: "accept", token: makeToken({ bookingUid: "booking-a", userId: 2, iat: nowSeconds() }) },
        { action: "accept", token: validToken({ iat: nowSeconds() - 31 * 24 * 60 * 60 }) },
        // next.config.ts redirects /booking/direct/:action/:email/:bookingUid/:oldToken to this query shape.
        { action: "accept", email: "a@example.com", bookingUid: "booking-a", oldToken: validToken() },
      ];

      for (const params of cases) {
        expect(responseShape(await getLink(params))).toEqual({
          status: 303,
          location: INVALID_LINK_LOCATION,
        });
      }
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("gives the same answer when a database lookup throws", async () => {
      vi.mocked(prisma.booking.findUnique).mockRejectedValueOnce(new Error("connection refused"));
      expect(responseShape(await getLink({ action: "accept", token: validToken() }))).toEqual({
        status: 303,
        location: INVALID_LINK_LOCATION,
      });
    });
  });

  describe("U8f - the confirm page's POST decides, once", () => {
    it("accepts exactly once for a valid token and opens the booking with a 303", async () => {
      const res = await postLink({ token: validToken(), action: "accept" });

      expect(responseShape(res)).toEqual({ status: 303, location: BOOKING_PAGE });
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(mockConfirmHandler.mock.calls[0][0].ctx.user.id).toBe(1);
      expect(mockConfirmHandler.mock.calls[0][0].input).toEqual(
        expect.objectContaining({ bookingId: 11, confirmed: true, emailsEnabled: true })
      );
    });

    it("rejects exactly once, with the reason from the form", async () => {
      const res = await postLink({ token: validToken(), action: "reject", reason: "  Ta termin ne gre.  " });

      expect(responseShape(res)).toEqual({ status: 303, location: BOOKING_PAGE });
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(mockConfirmHandler.mock.calls[0][0].input).toEqual(
        expect.objectContaining({ bookingId: 11, confirmed: false, reason: "Ta termin ne gre." })
      );
    });

    it("accepts a JSON body too", async () => {
      await postLink({ token: validToken(), action: "accept" }, { contentType: "application/json" });
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
    });

    it("sends no reason for an empty field or an acceptance", async () => {
      await postLink({ token: validToken(), action: "reject", reason: "   " });
      await postLink({ token: validToken(), action: "accept", reason: "ignored" });

      expect(mockConfirmHandler.mock.calls[0][0].input.reason).toBeUndefined();
      expect(mockConfirmHandler.mock.calls[1][0].input.reason).toBeUndefined();
    });

    it("takes a reason up to 2000 characters and refuses a longer one", async () => {
      await postLink({ token: validToken(), action: "reject", reason: "r".repeat(2000) });
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      const res = await postLink({ token: validToken(), action: "reject", reason: "r".repeat(2001) });
      expect(responseShape(res)).toEqual({ status: 303, location: INVALID_LINK_LOCATION });
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("reads the token and the action from the body only, never from the query", async () => {
      const res = await postLink({}, { query: { token: validToken(), action: "accept" } });

      expect(responseShape(res)).toEqual({ status: 303, location: INVALID_LINK_LOCATION });
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("refuses a body it can't read, the same way as an invalid link", async () => {
      const cases: [string, string][] = [
        ["{not json", "application/json"],
        [`token=${encodeURIComponent(validToken())}&action=accept`, "text/plain"],
        ["", "application/x-www-form-urlencoded"],
        ["[1,2]", "application/json"],
      ];
      for (const [body, contentType] of cases) {
        expect(responseShape(await postLink(body, { contentType }))).toEqual({
          status: 303,
          location: INVALID_LINK_LOCATION,
        });
      }
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("redirects on WEBAPP_URL whatever origin the request came in on", async () => {
      for (const origin of ["https://app.cal.com", "https://acme.cal.com", "http://192.168.1.100:3000"]) {
        vi.clearAllMocks();
        const res = await postLink({ token: validToken(), action: "accept" }, { origin });
        expect(responseShape(res)).toEqual({ status: 303, location: BOOKING_PAGE });
        expect(res.headers.get("location")).not.toContain("localhost");
      }
    });

    it("opens the booking with the error when the confirm handler throws a TRPCError", async () => {
      const { TRPCError } = await import("@trpc/server");
      mockConfirmHandler.mockRejectedValueOnce(
        new TRPCError({ code: "BAD_REQUEST", message: "Custom error" })
      );

      const res = await postLink({ token: validToken(), action: "accept" });
      const location = new URL(res.headers.get("location")!);

      expect(res.status).toBe(303);
      expect(location.origin).toBe(EXPECTED_REDIRECT_ORIGIN);
      expect(location.pathname).toBe("/booking/booking-a");
      expect(location.searchParams.get("error")).toBe("Custom error");
    });

    it("uses a generic error for anything else the confirm handler throws", async () => {
      mockConfirmHandler.mockRejectedValueOnce(new Error("db down: secret detail"));

      const res = await postLink({ token: validToken(), action: "accept" });
      expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe(
        "Error confirming booking"
      );
    });

    it("passes the booking's recurringEventId", async () => {
      BOOKINGS["booking-a"].recurringEventId = "recurring-123";

      await postLink({ token: validToken(), action: "accept" });

      expect(mockConfirmHandler.mock.calls[0][0].input).toEqual(
        expect.objectContaining({ bookingId: 11, recurringEventId: "recurring-123", confirmed: true })
      );
    });

    it("passes the organizer as the confirm handler's user", async () => {
      await postLink({ token: validToken(), action: "accept" });

      expect(mockConfirmHandler.mock.calls[0][0].ctx.user).toEqual({
        id: 1,
        uuid: "user-a-uuid",
        email: "a@example.com",
        username: "organizer-a",
        role: "USER",
        destinationCalendar: null,
      });
    });

    it("decides once when the button is pressed twice at the same time", async () => {
      let finish: () => void = () => undefined;
      mockConfirmHandler.mockImplementationOnce(
        (() =>
          new Promise<void>((resolve) => {
            finish = () => {
              BOOKINGS["booking-a"].status = BookingStatus.REJECTED;
              resolve();
            };
          })) as never
      );

      const token = validToken();
      const first = postLink({ token, action: "reject", reason: "x" });
      const second = postLink({ token, action: "reject", reason: "x" });
      // Both have read PENDING before the first decision is written
      await vi.waitFor(() => expect(mockConfirmHandler).toHaveBeenCalledTimes(1));
      const secondRes = await second;
      finish();
      const firstRes = await first;

      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(responseShape(firstRes)).toEqual({ status: 303, location: BOOKING_PAGE });
      expect(responseShape(secondRes)).toEqual({ status: 303, location: BOOKING_PAGE });
    });

    it("reads the status again inside the slot, so a decision written meanwhile is not repeated", async () => {
      // The link's lookup still saw PENDING; by the time this POST holds the slot another one has decided
      vi.mocked(prisma.booking.findUnique)
        .mockResolvedValueOnce(BOOKINGS["booking-a"] as never)
        .mockResolvedValueOnce({ status: BookingStatus.REJECTED } as never);

      const res = await postLink({ token: validToken(), action: "accept" });

      expect(responseShape(res)).toEqual({ status: 303, location: BOOKING_PAGE });
      expect(prisma.booking.findUnique).toHaveBeenLastCalledWith({
        where: { id: 11 },
        select: { status: true },
      });
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("frees the slot after a failed decision, so the organizer can press again", async () => {
      mockConfirmHandler.mockRejectedValueOnce(new Error("calendar down"));
      await postLink({ token: validToken(), action: "accept" });
      await postLink({ token: validToken(), action: "accept" });

      expect(mockConfirmHandler).toHaveBeenCalledTimes(2);
    });
  });

  // Flowko: NAR-1. The token is authenticated, the acting organizer comes from the booking row, and every
  // invalid link gets one identical response, so there is no padding oracle and no forgery. Since U8f these
  // checks guard the POST, the only request that decides.
  describe("NAR-1 - authenticated token, organizer from the booking, uniform failure", () => {
    const callLink = (params: Record<string, string>) => postLink(params);

    const expectInvalidLink = (res: Response) => {
      expect(responseShape(res)).toEqual({ status: 303, location: INVALID_LINK_LOCATION });
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    };

    it("confirms as the organizer loaded from booking.userId", async () => {
      const res = await callLink({ action: "accept", token: validToken() });

      expect(res.headers.get("location")).toBe(BOOKING_PAGE);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(mockConfirmHandler.mock.calls[0][0].ctx.user.id).toBe(1);
    });

    it("rejects as the organizer loaded from booking.userId", async () => {
      const res = await callLink({
        action: "reject",
        token: makeToken({ bookingUid: "booking-b", userId: 2, iat: nowSeconds() }),
      });

      expect(res.headers.get("location")).toBe(`${EXPECTED_REDIRECT_ORIGIN}/booking/booking-b`);
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(mockConfirmHandler.mock.calls[0][0].ctx.user.id).toBe(2);
      expect(mockConfirmHandler.mock.calls[0][0].input).toEqual(
        expect.objectContaining({ bookingId: 22, confirmed: false })
      );
    });

    it("refuses a valid token that names booking A with user B's id", async () => {
      const res = await callLink({
        action: "accept",
        token: makeToken({ bookingUid: "booking-a", userId: 2, iat: nowSeconds() }),
      });

      expectInvalidLink(res);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("refuses a booking without an organizer", async () => {
      expectInvalidLink(
        await callLink({
          action: "accept",
          token: makeToken({ bookingUid: "booking-orphan", userId: 0, iat: nowSeconds() }),
        })
      );
    });

    it("refuses a token for an unknown booking, and one whose organizer no longer exists", async () => {
      expectInvalidLink(
        await callLink({
          action: "accept",
          token: makeToken({ bookingUid: "no-such-booking", userId: 1, iat: nowSeconds() }),
        })
      );

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      expectInvalidLink(await callLink({ action: "accept", token: validToken() }));
    });

    it("refuses the token when any single character is changed", async () => {
      const token = validToken();
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      for (let i = 0; i < token.length; i++) {
        vi.clearAllMocks();
        const next = alphabet[(alphabet.indexOf(token[i]) + 1) % alphabet.length];
        const tampered = token.slice(0, i) + next + token.slice(i + 1);
        expectInvalidLink(await callLink({ action: "accept", token: tampered }));
      }
    });

    it("refuses the token when any single byte is flipped", async () => {
      const raw = Buffer.from(validToken(), "base64url");
      for (let i = 0; i < raw.length; i++) {
        vi.clearAllMocks();
        const tampered = Buffer.from(raw);
        tampered[i] ^= 0x01;
        expectInvalidLink(await callLink({ action: "accept", token: tampered.toString("base64url") }));
      }
    });

    it("refuses an old unauthenticated AES-256-CBC token, even one naming the real organizer", async () => {
      const legacy = symmetricEncrypt(JSON.stringify({ bookingUid: "booking-a", userId: 1 }), TEST_KEY);
      expectInvalidLink(await callLink({ action: "accept", token: legacy }));
      expectInvalidLink(await callLink({ action: "accept", token: encodeURIComponent(legacy) }));
    });

    it("refuses a token encrypted under another purpose's derived key", async () => {
      const payload = JSON.stringify({ bookingUid: "booking-a", userId: 1, iat: nowSeconds() });
      const underOtherLabel = symmetricEncryptAuthenticated(payload, TEST_KEY, "flowko:other-purpose");
      expectInvalidLink(await callLink({ action: "accept", token: underOtherLabel }));
    });

    it("refuses an expired token and one issued in the future", async () => {
      const thirtyOneDays = 31 * 24 * 60 * 60;
      expectInvalidLink(
        await callLink({ action: "accept", token: validToken({ iat: nowSeconds() - thirtyOneDays }) })
      );
      expectInvalidLink(
        await callLink({ action: "accept", token: validToken({ iat: nowSeconds() + 60 * 60 }) })
      );
    });

    it("accepts a token right up to the 30-day expiry, and re-checks it at the POST", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
      const token = validToken();
      vi.setSystemTime(new Date("2026-10-24T11:59:00Z"));

      // The page was opened just in time ...
      expect((await getLink({ action: "accept", token })).headers.get("location")).toBe(
        confirmPageFor(token, "accept")
      );
      const res = await callLink({ action: "accept", token });
      expect(res.headers.get("location")).toBe(BOOKING_PAGE);
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);

      // ... but a button pressed after the expiry does nothing.
      vi.clearAllMocks();
      vi.setSystemTime(new Date("2026-10-24T12:01:00Z"));
      expectInvalidLink(await callLink({ action: "accept", token }));
    });

    it("refuses a token without an issued-at", async () => {
      expectInvalidLink(
        await callLink({ action: "accept", token: makeToken({ bookingUid: "booking-a", userId: 1 }) })
      );
    });

    it("answers bad padding, bad JSON, bad schema, bad input and not-found identically, without throwing", async () => {
      // AES-256-CBC with invalid PKCS#7 padding: the old padding-oracle "bad decrypt" case.
      const badPadding = `${"00".repeat(16)}:${"11".repeat(32)}`;
      // AES-256-CBC with valid padding but a non-JSON plaintext: the old "Unexpected error" case.
      const badJsonCbc = symmetricEncrypt("not json", TEST_KEY);
      // Authenticated, but not JSON / not the schema.
      const badJson = symmetricEncryptAuthenticated("not json", TEST_KEY, LINK_TOKEN_KEY_LABEL);
      const badSchema = makeToken({ bookingUid: 123, userId: "1", iat: nowSeconds() });

      const cases: Record<string, string>[] = [
        { action: "accept", token: badPadding },
        { action: "accept", token: badJsonCbc },
        { action: "accept", token: badJson },
        { action: "accept", token: badSchema },
        { action: "accept", token: "%E0%A4%A" }, // malformed percent-encoding
        { action: "accept", token: "" },
        { action: "accept" }, // no token
        { action: "approve", token: validToken() }, // unknown action
        { action: "accept", token: makeToken({ bookingUid: "no-such", userId: 1, iat: nowSeconds() }) },
      ];

      const shapes = [];
      for (const params of cases) {
        const res = await callLink(params);
        shapes.push(responseShape(res));
      }

      expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(1);
      expect(shapes[0]).toEqual({ status: 303, location: INVALID_LINK_LOCATION });
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("gives the same answer when a database lookup throws", async () => {
      vi.mocked(prisma.booking.findUnique).mockRejectedValueOnce(new Error("connection refused"));
      expectInvalidLink(await callLink({ action: "accept", token: validToken() }));
    });

    it("ignores bookingUid and userId next to a valid token", async () => {
      await callLink({ action: "accept", token: validToken(), bookingUid: "booking-b", userId: "2" });

      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(mockConfirmHandler.mock.calls[0][0].ctx.user.id).toBe(1);
      expect(mockConfirmHandler.mock.calls[0][0].input.bookingId).toBe(11);
    });

    it("fails closed when CALENDSO_ENCRYPTION_KEY is missing", async () => {
      const token = validToken();
      vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "");
      expectInvalidLink(await callLink({ action: "accept", token }));
    });
  });

  // Flowko (U8e): the token is multi-use for 30 days and reaches the booker when the organizer replies to the
  // request email, so it may decide a booking only while the booking is still waiting for that decision
  describe("U8e - acts only on a pending booking", () => {
    it("reads the booking's status", async () => {
      await postLink({ action: "accept", token: validToken() });

      expect(prisma.booking.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.objectContaining({ status: true }) })
      );
    });

    it.each([
      [BookingStatus.REJECTED, "accept"],
      [BookingStatus.CANCELLED, "accept"],
      [BookingStatus.ACCEPTED, "reject"],
      [BookingStatus.ACCEPTED, "accept"],
      [BookingStatus.AWAITING_HOST, "accept"],
      [BookingStatus.REJECTED, "reject"],
    ])("leaves a %s booking as it is on %s and opens its page", async (status, action) => {
      BOOKINGS["booking-a"].status = status;

      const res = await postLink({ action, token: validToken() });

      expect(responseShape(res)).toEqual({ status: 303, location: BOOKING_PAGE });
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("can't turn the organizer's rejection into an acceptance with the same link", async () => {
      const token = validToken();
      mockConfirmHandler.mockImplementation((async ({ input }: { input: { confirmed: boolean } }) => {
        BOOKINGS["booking-a"].status = input.confirmed ? BookingStatus.ACCEPTED : BookingStatus.REJECTED;
        return { message: "", status: BOOKINGS["booking-a"].status };
      }) as never);

      await postLink({ action: "reject", token });
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(BOOKINGS["booking-a"].status).toBe(BookingStatus.REJECTED);

      // The quoted link, opened later by whoever received the organizer's reply, and its button pressed
      await getLink({ action: "accept", token });
      const res = await postLink({ action: "accept", token });
      await postLink({ action: "reject", token });

      expect(responseShape(res)).toEqual({ status: 303, location: BOOKING_PAGE });
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(BOOKINGS["booking-a"].status).toBe(BookingStatus.REJECTED);
    });
  });
});
