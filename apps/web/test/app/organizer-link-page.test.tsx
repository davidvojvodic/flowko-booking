import { LINK_TOKEN_KEY_LABEL, symmetricEncryptAuthenticated } from "@calcom/lib/crypto";
import { BookingStatus } from "@calcom/prisma/enums";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Flowko (U8f): the confirm page the organizer's e-mailed accept/reject link opens (/booking/link). Opening it
// never decides; it shows the booking's title and time in the organizer's language and a button that POSTs to
// /api/link. This file lives outside apps/web/app on purpose: pagesAndRewritePaths.ts scans the file names there
// as top-level routes. Real crypto, real translations (packages/i18n/locales), real dayjs; only the database,
// the request locale and the confirm handler are mocked.

const mocks = vi.hoisted(() => ({
  requestLocale: "en",
  bookings: {} as Record<string, Record<string, unknown>>,
  users: {} as Record<number, Record<string, unknown>>,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], get: () => undefined }),
}));
vi.mock("@calcom/features/auth/lib/getLocale", () => ({
  getLocale: vi.fn(async () => mocks.requestLocale),
}));
vi.mock("@calcom/prisma", () => {
  const prisma = {
    booking: {
      findUnique: vi.fn(async (args: { where: { uid: string } }) => mocks.bookings[args.where.uid] ?? null),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(async (args: { where: { id: number } }) => mocks.users[args.where.id] ?? null),
      update: vi.fn(),
    },
  };
  return { default: prisma, prisma };
});
vi.mock("@calcom/trpc/server/routers/viewer/bookings/confirm.handler", () => ({ confirmHandler: vi.fn() }));

import prisma from "@calcom/prisma";
import { confirmHandler } from "@calcom/trpc/server/routers/viewer/bookings/confirm.handler";

const TEST_KEY = "abcdefghjnmkljhjklmnhjklkmnbhjui";
const nowSeconds = () => Math.floor(Date.now() / 1000);
const makeToken = (payload: Record<string, unknown>) =>
  symmetricEncryptAuthenticated(JSON.stringify(payload), TEST_KEY, LINK_TOKEN_KEY_LABEL);
const tokenFor = (bookingUid: string, userId: number, iat = nowSeconds()) =>
  makeToken({ bookingUid, userId, iat });

const baseBooking = {
  recurringEventId: null,
  status: BookingStatus.PENDING,
  // 5 Oct 2026, 10:00-10:30 in Ljubljana (CEST), 09:00-09:30 in London (BST)
  startTime: new Date("2026-10-05T08:00:00Z"),
  endTime: new Date("2026-10-05T08:30:00Z"),
};

async function renderPage(searchParams: Record<string, string | string[] | undefined>) {
  const { default: Page } = await import("app/(booking-page-wrapper)/booking/link/page");
  const element = (await Page({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement;
  return render(element);
}

const expectNothingDecided = () => {
  expect(confirmHandler).not.toHaveBeenCalled();
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  expect(prisma.user.update).not.toHaveBeenCalled();
};

describe("/booking/link confirm page (Flowko U8f)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", TEST_KEY);
    mocks.requestLocale = "en";
    mocks.bookings = {
      "booking-sl": {
        ...baseBooking,
        id: 11,
        uid: "booking-sl",
        userId: 1,
        title: "Ogled stanovanja med Ana in Flowko",
      },
      "booking-en": {
        ...baseBooking,
        id: 22,
        uid: "booking-en",
        userId: 2,
        title: "Viewing between Ana and Flowko",
      },
    };
    mocks.users = {
      1: {
        id: 1,
        uuid: "u1",
        email: "organizer-sl@example.com",
        username: "organizer-sl",
        role: "USER",
        destinationCalendar: null,
        locale: "sl",
        timeZone: "Europe/Ljubljana",
        timeFormat: 24,
      },
      2: {
        id: 2,
        uuid: "u2",
        email: "organizer-en@example.com",
        username: "organizer-en",
        role: "USER",
        destinationCalendar: null,
        locale: "en",
        timeZone: "Europe/London",
        timeFormat: 12,
      },
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("shows a Slovenian organizer the booking and a „Potrdi rezervacijo“ button that POSTs the token, and decides nothing", async () => {
    const token = tokenFor("booking-sl", 1);
    const { container } = await renderPage({ token, action: "accept" });

    expect(screen.getByRole("heading", { name: "Želite potrditi to rezervacijo?" })).toBeTruthy();
    expect(screen.getByTestId("organizer-link-title").textContent).toBe("Ogled stanovanja med Ana in Flowko");
    expect(screen.getByTestId("organizer-link-when").textContent).toBe(
      "ponedeljek, 5. oktober 2026 | 10:00 - 10:30 (Europe/Ljubljana)"
    );
    expect(screen.getByText("Kaj")).toBeTruthy();
    expect(screen.getByText("Kdaj")).toBeTruthy();

    const form = screen.getByTestId("organizer-link-form") as HTMLFormElement;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/link");
    expect(Object.fromEntries(new FormData(form).entries())).toEqual({ token, action: "accept" });
    const button = screen.getByTestId("organizer-link-submit");
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.textContent).toContain("Potrdi rezervacijo");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("[lang]")?.getAttribute("lang")).toBe("sl");

    expectNothingDecided();
  });

  it("offers a Slovenian organizer „Zavrni rezervacijo“ with an optional reason of up to 2000 characters", async () => {
    const token = tokenFor("booking-sl", 1);
    await renderPage({ token, action: "reject" });

    expect(screen.getByRole("heading", { name: "Želite zavrniti to rezervacijo?" })).toBeTruthy();
    expect(screen.getByTestId("organizer-link-submit").textContent).toContain("Zavrni rezervacijo");
    const reason = screen.getByLabelText("Razlog za zavrnitev (neobvezno)") as HTMLTextAreaElement;
    expect(reason.name).toBe("reason");
    expect(reason.maxLength).toBe(2000);
    expect(reason.required).toBe(false);

    const form = screen.getByTestId("organizer-link-form") as HTMLFormElement;
    expect(Object.fromEntries(new FormData(form).entries())).toEqual({ token, action: "reject", reason: "" });
    expectNothingDecided();
  });

  it("speaks the organizer's language, time zone and clock: English, London, 12-hour", async () => {
    mocks.requestLocale = "sl"; // the browser's language does not win over the organizer's
    const { container } = await renderPage({ token: tokenFor("booking-en", 2), action: "reject" });

    expect(screen.getByRole("heading", { name: "Reject this booking?" })).toBeTruthy();
    expect(screen.getByTestId("organizer-link-when").textContent).toBe(
      "Monday, October 5, 2026 | 9:00am - 9:30am (Europe/London)"
    );
    expect(screen.getByLabelText("Reason for rejecting (optional)")).toBeTruthy();
    expect(screen.getByTestId("organizer-link-submit").textContent).toContain("Reject booking");
    expect(container.querySelector("[lang]")?.getAttribute("lang")).toBe("en");
  });

  it("falls back to the request's language when the organizer's is not one the app ships", async () => {
    mocks.users[2].locale = "xx";
    mocks.requestLocale = "sl";
    await renderPage({ token: tokenFor("booking-en", 2), action: "accept" });

    expect(screen.getByRole("heading", { name: "Želite potrditi to rezervacijo?" })).toBeTruthy();
  });

  it("shows nothing of the booking but its title and time: no organizer or attendee data", async () => {
    const { container } = await renderPage({ token: tokenFor("booking-sl", 1), action: "accept" });

    expect(container.innerHTML).not.toContain("@example.com");
    expect(container.innerHTML).not.toContain("organizer-sl");
    // The lookup itself asks for nothing else of the booking
    expect(vi.mocked(prisma.booking.findUnique).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        select: {
          id: true,
          uid: true,
          userId: true,
          recurringEventId: true,
          status: true,
          title: true,
          startTime: true,
          endTime: true,
        },
      })
    );
  });

  it("disables the button once pressed, so one press sends one decision", async () => {
    await renderPage({ token: tokenFor("booking-sl", 1), action: "accept" });
    const form = screen.getByTestId("organizer-link-form") as HTMLFormElement;
    const button = screen.getByTestId("organizer-link-submit") as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    // fireEvent returns false when a handler cancelled the event. jsdom does not navigate on a dispatched submit.
    const firstGoesThrough = fireEvent.submit(form);
    expect(button.disabled).toBe(true);
    const secondGoesThrough = fireEvent.submit(form);

    expect([firstGoesThrough, secondGoesThrough]).toEqual([true, false]);
    expectNothingDecided();
  });

  it.each([
    [BookingStatus.ACCEPTED, "accept"],
    [BookingStatus.REJECTED, "accept"],
    [BookingStatus.CANCELLED, "reject"],
    [BookingStatus.AWAITING_HOST, "accept"],
  ])("says a %s booking no longer waits (%s), offers no button and links to the booking", async (status, action) => {
    mocks.bookings["booking-sl"].status = status;
    const { container } = await renderPage({ token: tokenFor("booking-sl", 1), action });

    expect(screen.getByRole("heading", { name: "Ta rezervacija ne čaka več na potrditev" })).toBeTruthy();
    expect(screen.queryByTestId("organizer-link-form")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    const next = screen.getByTestId("organizer-link-next");
    expect(next.getAttribute("href")).toBe("/booking/booking-sl");
    expect(screen.getByTestId("organizer-link-title").textContent).toBe("Ogled stanovanja med Ana in Flowko");
    expectNothingDecided();
  });

  it("gives every invalid link one message in the request's language, with no button and no booking data", async () => {
    mocks.requestLocale = "sl";
    const cases: Record<string, string | string[] | undefined>[] = [
      {},
      { action: "accept" },
      { token: tokenFor("booking-sl", 1) },
      { token: tokenFor("booking-sl", 1), action: "approve" },
      { token: "not-a-token", action: "accept" },
      { token: tokenFor("booking-sl", 2), action: "accept" }, // another organizer's id
      { token: tokenFor("no-such-booking", 1), action: "accept" },
      { token: tokenFor("booking-sl", 1, nowSeconds() - 31 * 24 * 60 * 60), action: "accept" }, // expired
      { token: [tokenFor("booking-sl", 1), "x"], action: "accept" }, // a repeated param
    ];

    for (const searchParams of cases) {
      const { container, unmount } = await renderPage(searchParams);
      expect(screen.getByRole("heading", { name: "Ta povezava ni veljavna" })).toBeTruthy();
      expect(screen.getByTestId("organizer-link-next").getAttribute("href")).toBe("/bookings/unconfirmed");
      expect(screen.getByTestId("organizer-link-next").textContent).toBe("Odpri nepotrjene rezervacije");
      expect(screen.queryByTestId("organizer-link-form")).toBeNull();
      expect(screen.queryByTestId("organizer-link-title")).toBeNull();
      expect(container.innerHTML).not.toContain("Ogled stanovanja");
      expect(container.querySelector("[lang]")?.getAttribute("lang")).toBe("sl");
      unmount();
    }
    expectNothingDecided();
  });

  it("says so in English for an English request", async () => {
    await renderPage({ token: "broken", action: "accept" });

    expect(screen.getByRole("heading", { name: "This link is not valid" })).toBeTruthy();
    expect(screen.getByTestId("organizer-link-next").textContent).toBe("Open unconfirmed bookings");
  });

  it("keeps the page out of search engines and its token out of Referer headers", async () => {
    mocks.requestLocale = "sl";
    const { generateMetadata } = await import("app/(booking-page-wrapper)/booking/link/page");
    const metadata = await generateMetadata();

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
    expect(String(metadata.title)).toMatch(/^Zahteva za rezervacijo \| /);
  });
});
