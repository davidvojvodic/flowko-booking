// Flowko U27: the call-the-business page's helpers and the branch each public Cal page runs before it books:
// /[user], /[user]/[type] (plain and embed), /d/[link]/[slug], /reschedule/[uid] and EventRepository.getPublicEvent.
// Business A (owner Olga, worker Ana, staff Rok, locked worker Dan); Ana and Olga have a mirror, Ana's carries a
// business booking, Olga's own event type an ordinary one. Real helpers on prismock through the global client;
// everything else the pages call is mocked.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
import "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usersByName: {} as Record<string, Record<string, unknown>>,
  hashedLink: null as Record<string, unknown> | null,
  getPublicEvent: vi.fn(),
  buildEventUrlFromBooking: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock("@lib/handleOrgRedirect", () => ({
  handleOrgRedirect: vi.fn(async () => null),
  getRedirectWithOriginAndSearchString: vi.fn(async () => null),
}));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: class {
    async findUsersByUsername({ usernameList }: { usernameList: string[] }) {
      return usernameList.map((name) => mocks.usersByName[name]).filter(Boolean);
    }
    async findPlatformMembersByUsernames() {
      return [];
    }
    async enrichUserWithItsProfile({ user }: { user: unknown }) {
      return user;
    }
  },
}));
vi.mock("@calcom/features/eventtypes/lib/getEventTypesPublic", () => ({
  getEventTypesPublic: vi.fn(async () => []),
}));
vi.mock("@calcom/features/eventtypes/lib/getPublicEvent", () => ({ getPublicEvent: mocks.getPublicEvent }));
vi.mock("@calcom/features/profile/lib/hideBranding", () => ({
  shouldHideBrandingForUserEvent: vi.fn(() => false),
  shouldHideBrandingForTeamEvent: vi.fn(() => false),
}));
vi.mock("@calcom/features/bookings/lib/get-booking", () => ({
  getBookingForReschedule: vi.fn(async () => null),
  getBookingForSeatedEvent: vi.fn(async () => null),
  getMultipleDurationValue: vi.fn(() => 30),
}));
vi.mock("@calcom/features/hashedLink/lib/service/HashedLinkService", () => ({
  HashedLinkService: class {
    async validate() {}
    async findLinkWithDetails() {
      return mocks.hashedLink;
    }
  },
}));
vi.mock("@calcom/features/bookings/lib/buildEventUrlFromBooking", () => ({
  buildEventUrlFromBooking: mocks.buildEventUrlFromBooking,
}));
vi.mock("@calcom/features/bookings/lib/reschedule/determineReschedulePreventionRedirect", () => ({
  determineReschedulePreventionRedirect: vi.fn(() => null),
}));
vi.mock("@calcom/lib/server/maybeGetBookingUidFromSeat", () => ({
  maybeGetBookingUidFromSeat: vi.fn(async (_db: unknown, uid: string) => ({
    uid,
    seatReferenceUid: undefined,
    bookingSeat: null,
  })),
}));
vi.mock("@calcom/lib/markdownToSafeHTML", () => ({
  markdownToSafeHTML: (text: string | null) => text ?? "",
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { EventRepository } from "@calcom/features/eventtypes/repositories/EventRepository";
import { addLoginMember, createBusiness } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import { ensureWorkerMirror } from "@calcom/features/flowkoBusiness/mirror";
import withEmbedSsrAppDir from "app/WithEmbedSSR";
import type { GetServerSidePropsContext } from "next";
import { getServerSideProps as typeServerSideProps } from "../../server/lib/[user]/[type]/getServerSideProps";
import { getServerSideProps as userServerSideProps } from "../../server/lib/[user]/getServerSideProps";
import { getServerSideProps as privateLinkServerSideProps } from "../d/[link]/[slug]/getServerSideProps";
import { getServerSideProps as rescheduleServerSideProps } from "../reschedule/[uid]/getServerSideProps";
import {
  callPageForBookingUid,
  callPageForEventType,
  callPageForUser,
  callPageForUserSlug,
  callPagePath,
  loadCallPageBusiness,
} from "./callPage";

const db = prismock as unknown as FlowkoDb;
const tx = prismock as unknown as Prisma.TransactionClient;
let seq = 0;

async function makeUser(name: string): Promise<{ id: number; username: string }> {
  seq += 1;
  const username = `${name.toLowerCase()}${seq}`;
  const user = await prismock.user.create({
    data: { email: `${username}@example.com`, username, name },
    select: { id: true },
  });
  mocks.usersByName[username] = {
    id: user.id,
    username,
    name,
    bio: null,
    avatarUrl: null,
    verified: false,
    allowSEOIndexing: true,
    profile: { organization: null, username, id: null, upId: `usr-${user.id}` },
  };
  return { id: user.id, username };
}

async function bookingOn(eventTypeId: number, userId: number): Promise<{ id: number; uid: string }> {
  seq += 1;
  return prismock.booking.create({
    data: {
      uid: `u27-call-booking-${seq}`,
      title: "Booking",
      startTime: new Date("2026-11-16T09:00:00Z"),
      endTime: new Date("2026-11-16T09:30:00Z"),
      eventTypeId,
      userId,
    },
    select: { id: true, uid: true },
  });
}

type Fixture = {
  slug: string;
  olga: { id: number; username: string };
  ana: { id: number; username: string };
  rok: { id: number; username: string };
  dan: { id: number; username: string };
  stranger: { id: number; username: string };
  anaMirror: { eventTypeId: number; slug: string };
  olgaMirror: { eventTypeId: number; slug: string };
  anaOrdinary: { id: number; slug: string };
  olgaOrdinary: { id: number; slug: string };
  business: { id: number; uid: string };
  ordinary: { id: number; uid: string };
};

async function mirrorSlugOf(eventTypeId: number): Promise<string> {
  const row = await prismock.eventType.findUnique({ where: { id: eventTypeId }, select: { slug: true } });
  return row?.slug ?? "";
}

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const slug = `salon-call-${seq}`;
  const created = await createBusiness(db, {
    ownerUserId: olga.id,
    name: "Salon Call",
    slug,
    templateId: "hair-salon",
    phone: "+386 1 234 56 78",
    address: "Slovenska cesta 1, Ljubljana",
  });
  await prismock.flowkoBusiness.update({ where: { id: created.businessId }, data: { openHolidays: [] } });
  const ana = await makeUser("Ana");
  const rok = await makeUser("Rok");
  const dan = await makeUser("Dan");
  const stranger = await makeUser("Stranger");
  const anaMember = await addLoginMember(db, created.businessId, ana.id, FlowkoBusinessRole.WORKER);
  await addLoginMember(db, created.businessId, rok.id, FlowkoBusinessRole.STAFF);
  const danMember = await addLoginMember(db, created.businessId, dan.id, FlowkoBusinessRole.WORKER);
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED, lockedAt: new Date() },
  });
  const olgaMemberRow = await prismock.flowkoBusinessMember.findUnique({
    where: { userId: olga.id },
    select: { id: true },
  });

  const anaMirror = await ensureWorkerMirror(tx, anaMember.memberId);
  const olgaMirror = await ensureWorkerMirror(tx, olgaMemberRow!.id);
  const anaOrdinary = await prismock.eventType.create({
    data: { title: "Ana ordinary", slug: `ana-ordinary-${seq}`, length: 30, userId: ana.id },
    select: { id: true, slug: true },
  });
  const olgaOrdinary = await prismock.eventType.create({
    data: { title: "Olga ordinary", slug: `olga-ordinary-${seq}`, length: 30, userId: olga.id },
    select: { id: true, slug: true },
  });
  return {
    slug,
    olga,
    ana,
    rok,
    dan,
    stranger,
    anaMirror: { eventTypeId: anaMirror.eventTypeId, slug: await mirrorSlugOf(anaMirror.eventTypeId) },
    olgaMirror: { eventTypeId: olgaMirror.eventTypeId, slug: await mirrorSlugOf(olgaMirror.eventTypeId) },
    anaOrdinary,
    olgaOrdinary,
    business: await bookingOn(anaMirror.eventTypeId, ana.id),
    ordinary: await bookingOn(olgaOrdinary.id, olga.id),
  };
}

let f: Fixture;

beforeEach(async () => {
  mocks.getPublicEvent.mockReset();
  mocks.getPublicEvent.mockImplementation(
    async (_u: string, _s: string, _t: unknown, _o: unknown, _p: unknown, _f: unknown) => ({
      id: 4242,
      title: "Event",
      metadata: {},
      owner: null,
    })
  );
  mocks.buildEventUrlFromBooking.mockReset();
  mocks.hashedLink = null;
  f = await setUp();
});

const ctx = (params: Record<string, string>, query: Record<string, string> = {}) =>
  ({
    params,
    query: { ...params, ...query },
    req: { headers: {}, cookies: {} },
    res: { setHeader: vi.fn() },
  }) as unknown as GetServerSidePropsContext;

describe("callPagePath", () => {
  it("builds the page and the embed path", () => {
    expect(callPagePath("salon-a", false)).toBe("/poklicite/salon-a");
    expect(callPagePath("salon-a", true)).toBe("/poklicite/salon-a/embed");
  });
});

describe("call page helpers", () => {
  it("callPageForUser: worker, staff and locked worker -> business slug; owner and stranger -> null", async () => {
    expect(await callPageForUser(f.ana.id)).toBe(f.slug);
    expect(await callPageForUser(f.rok.id)).toBe(f.slug);
    expect(await callPageForUser(f.dan.id)).toBe(f.slug);
    expect(await callPageForUser(f.olga.id)).toBeNull();
    expect(await callPageForUser(f.stranger.id)).toBeNull();
  });

  it("callPageForEventType: a mirror -> its business slug; an ordinary type, a missing id -> null", async () => {
    expect(await callPageForEventType(f.anaMirror.eventTypeId)).toBe(f.slug);
    expect(await callPageForEventType(f.olgaMirror.eventTypeId)).toBe(f.slug);
    expect(await callPageForEventType(f.olgaOrdinary.id)).toBeNull();
    expect(await callPageForEventType(987654)).toBeNull();
  });

  it("callPageForUserSlug: any slug of a non-owner member, the owner's mirror slug only", async () => {
    expect(await callPageForUserSlug(f.ana.id, f.anaOrdinary.slug)).toBe(f.slug);
    expect(await callPageForUserSlug(f.ana.id, f.anaMirror.slug)).toBe(f.slug);
    expect(await callPageForUserSlug(f.olga.id, f.olgaMirror.slug)).toBe(f.slug);
    expect(await callPageForUserSlug(f.olga.id, f.olgaOrdinary.slug)).toBeNull();
    expect(await callPageForUserSlug(f.olga.id, f.anaMirror.slug)).toBeNull();
    expect(await callPageForUserSlug(f.stranger.id, f.olgaMirror.slug)).toBeNull();
  });

  it("callPageForBookingUid: a business booking -> slug; an ordinary booking, an unknown uid -> null", async () => {
    expect(await callPageForBookingUid(f.business.uid)).toBe(f.slug);
    expect(await callPageForBookingUid(f.ordinary.uid)).toBeNull();
    expect(await callPageForBookingUid("no-such-uid")).toBeNull();
  });

  it("loadCallPageBusiness: name, phone and address of the business; unknown slug -> null", async () => {
    expect(await loadCallPageBusiness(f.slug)).toEqual({
      name: "Salon Call",
      phone: "+386 1 234 56 78",
      address: "Slovenska cesta 1, Ljubljana",
    });
    expect(await loadCallPageBusiness("no-such-business")).toBeNull();
  });
});

describe("/[user]", () => {
  it("redirects a worker's profile to the call page; the owner's profile is unchanged", async () => {
    const worker = await userServerSideProps(ctx({ user: f.ana.username }));
    expect(worker).toEqual({ redirect: { permanent: false, destination: `/poklicite/${f.slug}` } });
    const staff = await userServerSideProps(ctx({ user: f.rok.username }));
    expect(staff).toEqual({ redirect: { permanent: false, destination: `/poklicite/${f.slug}` } });
    const owner = await userServerSideProps(ctx({ user: f.olga.username }));
    expect(owner).toHaveProperty("props");
    const stranger = await userServerSideProps(ctx({ user: f.stranger.username }));
    expect(stranger).toHaveProperty("props");
  });

  it("the embed variant ends in /poklicite/<slug>/embed, not a doubled /embed", async () => {
    const embedded = withEmbedSsrAppDir(userServerSideProps as never);
    await expect(
      embedded(ctx({ user: f.ana.username }, { embed: "ns", layout: "month_view" }))
    ).rejects.toThrow(`NEXT_REDIRECT /poklicite/${f.slug}/embed?layout=month_view&embed=ns`);
  });
});

describe("/[user]/[type]", () => {
  it("redirects the owner's mirror slug before getPublicEvent runs; the owner's ordinary slug is unchanged", async () => {
    const mirror = await typeServerSideProps(ctx({ user: f.olga.username, type: f.olgaMirror.slug }));
    expect(mirror).toEqual({ redirect: { permanent: false, destination: `/poklicite/${f.slug}` } });
    expect(mocks.getPublicEvent).not.toHaveBeenCalled();

    const ordinary = await typeServerSideProps(ctx({ user: f.olga.username, type: f.olgaOrdinary.slug }));
    expect(ordinary).toHaveProperty("props");
    expect(mocks.getPublicEvent).toHaveBeenCalledTimes(1);
  });

  it("redirects a worker's ordinary slug and mirror slug", async () => {
    const dest = { redirect: { permanent: false, destination: `/poklicite/${f.slug}` } };
    expect(await typeServerSideProps(ctx({ user: f.ana.username, type: f.anaOrdinary.slug }))).toEqual(dest);
    expect(await typeServerSideProps(ctx({ user: f.ana.username, type: f.anaMirror.slug }))).toEqual(dest);
    expect(await typeServerSideProps(ctx({ user: f.dan.username, type: "anything" }))).toEqual(dest);
    expect(mocks.getPublicEvent).not.toHaveBeenCalled();
  });

  it("a dynamic group with a worker in it redirects too", async () => {
    const result = await typeServerSideProps(
      ctx({ user: `${f.stranger.username}+${f.ana.username}`, type: "dynamic" })
    );
    expect(result).toEqual({ redirect: { permanent: false, destination: `/poklicite/${f.slug}` } });
    expect(mocks.getPublicEvent).not.toHaveBeenCalled();
  });

  it("the embed variant ends in /poklicite/<slug>/embed, not a doubled /embed", async () => {
    const embedded = withEmbedSsrAppDir(typeServerSideProps as never);
    await expect(
      embedded(ctx({ user: f.olga.username, type: f.olgaMirror.slug }, { embed: "ns", layout: "month_view" }))
    ).rejects.toThrow(`NEXT_REDIRECT /poklicite/${f.slug}/embed?layout=month_view&embed=ns`);
  });
});

describe("/d/[link]/[slug]", () => {
  function linkFor(eventTypeId: number, userId: number | null) {
    return {
      link: "abc123",
      eventTypeId,
      eventType: { userId, team: null, users: [{ username: "x", profiles: [] }] },
    };
  }

  it("redirects a private link on a mirror and on a worker's ordinary type", async () => {
    const dest = { redirect: { permanent: false, destination: `/poklicite/${f.slug}` } };
    mocks.hashedLink = linkFor(f.anaMirror.eventTypeId, f.ana.id);
    expect(await privateLinkServerSideProps(ctx({ link: "abc123", slug: "x" }))).toEqual(dest);
    mocks.hashedLink = linkFor(f.anaOrdinary.id, f.ana.id);
    expect(await privateLinkServerSideProps(ctx({ link: "abc123", slug: "x" }))).toEqual(dest);
    expect(mocks.getPublicEvent).not.toHaveBeenCalled();
  });

  it("leaves a private link on the owner's ordinary type unchanged", async () => {
    mocks.hashedLink = linkFor(f.olgaOrdinary.id, f.olga.id);
    mocks.usersByName.x = mocks.usersByName[f.olga.username];
    const result = await privateLinkServerSideProps(ctx({ link: "abc123", slug: "x" }));
    expect(result).toHaveProperty("props");
  });
});

describe("/reschedule/[uid]", () => {
  it("redirects a business booking to the call page before buildEventUrlFromBooking (which throws for a desk-only organizer)", async () => {
    mocks.buildEventUrlFromBooking.mockRejectedValue(new Error("desk-only organizer"));
    const result = await rescheduleServerSideProps(ctx({ uid: f.business.uid }, { uid: f.business.uid }));
    expect(result).toEqual({ redirect: { permanent: false, destination: `/poklicite/${f.slug}` } });
    expect(mocks.buildEventUrlFromBooking).not.toHaveBeenCalled();
  });

  it("an ordinary booking still builds the event URL", async () => {
    mocks.buildEventUrlFromBooking.mockResolvedValue("/olga/ordinary");
    const result = await rescheduleServerSideProps(ctx({ uid: f.ordinary.uid }, { uid: f.ordinary.uid }));
    expect(mocks.buildEventUrlFromBooking).toHaveBeenCalled();
    expect(result).toHaveProperty("redirect.destination");
    expect((result as { redirect: { destination: string } }).redirect.destination).toContain(
      "/olga/ordinary"
    );
  });
});

describe("EventRepository.getPublicEvent", () => {
  const input = (username: string, eventSlug: string) => ({
    username,
    eventSlug,
    org: null,
    fromRedirectOfNonOrgLink: false,
  });

  it("returns null for a worker mirror and the event for an ordinary event type", async () => {
    mocks.getPublicEvent.mockResolvedValueOnce({ id: f.olgaMirror.eventTypeId, title: "Salon Call" });
    expect(await EventRepository.getPublicEvent(input(f.olga.username, f.olgaMirror.slug))).toBeNull();
    mocks.getPublicEvent.mockResolvedValueOnce({ id: f.olgaOrdinary.id, title: "Olga ordinary" });
    expect(await EventRepository.getPublicEvent(input(f.olga.username, f.olgaOrdinary.slug))).toEqual({
      id: f.olgaOrdinary.id,
      title: "Olga ordinary",
    });
    mocks.getPublicEvent.mockResolvedValueOnce(null);
    expect(await EventRepository.getPublicEvent(input(f.olga.username, "none"))).toBeNull();
  });
});
