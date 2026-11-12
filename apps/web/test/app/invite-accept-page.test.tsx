// Flowko U29d (Task 8, A1, A6, A7): the invitee's page /auth/pridruzi/<token>. This file lives outside apps/web/app
// on purpose (pagesAndRewritePaths.ts scans the file names there). The real loader runs on prismock (no oracle:
// every unusable token renders the same InviteInvalid markup, with no salon, e-mail or person name); the session,
// the rate limiter and the request locale are mocked; the heading and the privacy line come from the real Slovene
// locale through i18next on the server.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported (the page imports it too).
import "@calcom/prisma";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { createBusiness, createDeskOnlyWorker } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import { readInviteForAcceptPage } from "@calcom/features/flowkoBusiness/inviteAccept";
import { hashInviteToken, newInviteToken } from "@calcom/features/flowkoBusiness/inviteToken";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { WEBSITE_PRIVACY_POLICY_URL } from "@calcom/lib/constants";
import { HttpError } from "@calcom/lib/http-error";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import type { PrismaClient } from "@calcom/prisma";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeT } from "~/flowko-settings/settings.fixture";

const IP = "198.51.100.7";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": IP }),
  cookies: async () => ({ getAll: () => [], get: () => undefined }),
}));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: vi.fn() }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
vi.mock("@calcom/features/auth/lib/getLocale", () => ({ getLocale: vi.fn(async () => "sl") }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: localeT("sl"), i18n: { language: "sl", exists: () => false }, isLocaleReady: true }),
}));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@calcom/features/flowkoBusiness/inviteAccept", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/features/flowkoBusiness/inviteAccept")>();
  return { ...actual, readInviteForAcceptPage: vi.fn(actual.readInviteForAcceptPage) };
});

const db = prismock as unknown as PrismaClient;
const mockSession = vi.mocked(getServerSession);
const mockRateLimit = vi.mocked(checkRateLimitAndThrowError);
const mockLoader = vi.mocked(readInviteForAcceptPage);
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

type Setup = { businessId: number; ownerUserId: number; deskMemberId: number };

async function setUp(businessName: string): Promise<Setup> {
  const ownerUserId = await makeUser("Olga");
  const created = await createBusiness(db as unknown as FlowkoDb, {
    ownerUserId,
    name: businessName,
    slug: `salon-${seq}`,
    templateId: "hair-salon",
    phone: "01 234 56 78",
  });
  const desk = await createDeskOnlyWorker(db, created.businessId, "Mojca");
  return { businessId: created.businessId, ownerUserId, deskMemberId: desk.memberId };
}

type InviteRow = {
  email?: string;
  name?: string;
  role?: FlowkoBusinessRole;
  memberId?: number | null;
  expiresAt?: Date;
  usedAt?: Date | null;
  revokedAt?: Date | null;
};

/** An invite row written straight into prismock; answers the raw token and the row id. */
async function addInvite(s: Setup, row: InviteRow = {}): Promise<{ token: string; id: number }> {
  const { token, tokenHash } = newInviteToken();
  const created = await prismock.flowkoBusinessInvite.create({
    data: {
      businessId: s.businessId,
      email: row.email ?? "hana@example.si",
      name: row.name ?? "Hana",
      role: row.role ?? FlowkoBusinessRole.WORKER,
      memberId: row.memberId ?? null,
      tokenHash,
      expiresAt: row.expiresAt ?? new Date(Date.now() + 7 * DAY),
      usedAt: row.usedAt ?? null,
      revokedAt: row.revokedAt ?? null,
      createdByUserId: s.ownerUserId,
    },
    select: { id: true },
  });
  return { token, id: created.id };
}

async function renderPage(token: string) {
  const { default: Page } = await import("app/(use-page-wrapper)/auth/pridruzi/[token]/page");
  const element = (await Page({
    params: Promise.resolve({ token }),
    searchParams: Promise.resolve({}),
  })) as ReactElement;
  return render(<TooltipProvider>{element}</TooltipProvider>);
}

const signedIn = () =>
  mockSession.mockResolvedValue({ user: { id: 7 } } as Awaited<ReturnType<typeof getServerSession>>);

describe("/auth/pridruzi/<token> (Flowko U29d A1, A6, A7)", () => {
  beforeEach(() => {
    mockSession.mockReset().mockResolvedValue(null);
    mockRateLimit.mockReset().mockResolvedValue(undefined as never);
    mockLoader.mockClear();
  });
  afterEach(cleanup);

  it("open invite: Slovene heading with the salon name, fixed e-mail, prefilled name, privacy line + link", async () => {
    const s = await setUp("Flowko Test");
    const { token } = await addInvite(s);

    await renderPage(token);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Pridružite se salonu Flowko Test");
    expect((screen.getByLabelText("E-pošta") as HTMLInputElement).value).toBe("hana@example.si");
    expect((screen.getByLabelText("E-pošta") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Ime") as HTMLInputElement).value).toBe("Hana");
    expect(screen.getByTestId("flowko-invite-privacy").textContent).toBe(
      "Upravljavec vaših podatkov je salon Flowko Test, Flowko pa je njegov obdelovalec. Obvestilo o zasebnosti"
    );
    const link = screen.getByRole("link", { name: "Obvestilo o zasebnosti" });
    expect(link.getAttribute("href")).toBe(WEBSITE_PRIVACY_POLICY_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("button", { name: "Pridruži se" })).toBeTruthy();
  });

  it("a desk-only member's invite opens with the member's name prefilled", async () => {
    const s = await setUp("Flowko Test");
    const { token } = await addInvite(s, {
      memberId: s.deskMemberId,
      name: "Mojca",
      email: "mojca@example.si",
    });

    await renderPage(token);

    expect((screen.getByLabelText("Ime") as HTMLInputElement).value).toBe("Mojca");
    expect((screen.getByLabelText("E-pošta") as HTMLInputElement).value).toBe("mojca@example.si");
  });

  it("a salon name with „&“ is not escaped twice in the heading or the privacy line", async () => {
    const s = await setUp("Frizerstvo Ana & Co");
    const { token } = await addInvite(s);

    const { container } = await renderPage(token);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Pridružite se salonu Frizerstvo Ana & Co"
    );
    expect(screen.getByTestId("flowko-invite-privacy").textContent).toContain("salon Frizerstvo Ana & Co,");
    expect(container.innerHTML).not.toContain("&amp;amp;");
    expect(container.textContent).not.toContain("&amp;");
  });

  it("a salon name with tag-like text renders as text, never as markup", async () => {
    const s = await setUp("Salon <1>x</1> <b>B</b>");
    const { token } = await addInvite(s);

    const { container } = await renderPage(token);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Pridružite se salonu Salon <1>x</1> <b>B</b>"
    );
    expect(screen.getByTestId("flowko-invite-privacy").textContent).toContain(
      "salon Salon <1>x</1> <b>B</b>,"
    );
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByTestId("flowko-invite-privacy").querySelectorAll("a")).toHaveLength(1);
  });

  it("every unusable token renders the same InviteInvalid markup, with no salon, e-mail or person name", async () => {
    const s = await setUp("Flowko Test");
    const past = new Date(Date.now() - 1000);
    const used = await addInvite(s, { usedAt: past, email: "u@example.si" });
    const revoked = await addInvite(s, { revokedAt: past, email: "r@example.si" });
    const expired = await addInvite(s, { expiresAt: past, email: "e@example.si" });
    const rotated = await addInvite(s, { email: "o@example.si" });
    await prismock.flowkoBusinessInvite.update({
      where: { id: rotated.id },
      data: { tokenHash: hashInviteToken(newInviteToken().token) },
    });
    const locked = await addInvite(s, { memberId: s.deskMemberId, email: "l@example.si", name: "Mojca" });
    await prismock.flowkoBusinessMember.update({
      where: { id: s.deskMemberId },
      data: { status: FlowkoMemberStatus.LOCKED },
    });
    const other = await setUp("Gone Salon");
    const gone = await addInvite(other, { email: "g@example.si" });
    await prismock.flowkoBusiness.delete({ where: { id: other.businessId } });

    const causes: Record<string, string> = {
      malformed: "short",
      unknown: newInviteToken().token,
      used: used.token,
      revoked: revoked.token,
      expired: expired.token,
      rotated: rotated.token,
      lockedMember: locked.token,
      businessGone: gone.token,
    };
    const markups: Record<string, string> = {};
    for (const [cause, token] of Object.entries(causes)) {
      const { container } = await renderPage(token);
      markups[cause] = container.innerHTML;
      expect(screen.getByRole("heading", { level: 2 }).textContent, cause).toBe("Povezava ne deluje");
      expect(screen.getByTestId("flowko-invite-invalid").textContent, cause).toBe(
        "Povezava je potekla, je bila že uporabljena ali je bila preklicana. Za novo se obrnite na salon."
      );
      expect(screen.queryByRole("textbox"), cause).toBeNull();
      for (const secret of ["Flowko Test", "Gone Salon", "@", "Mojca", "Hana"]) {
        expect(container.textContent, `${cause}: ${secret}`).not.toContain(secret);
      }
      cleanup();
    }
    expect(new Set(Object.values(markups)).size).toBe(1);
    expect(mockLoader).toHaveBeenCalledTimes(8);
  });

  it("GET is side-effect free: two renders of a live and a used token leave every invite row as it was", async () => {
    const s = await setUp("Flowko Test");
    const live = await addInvite(s);
    const used = await addInvite(s, { usedAt: new Date(Date.now() - 1000), email: "u@example.si" });
    const before = await prismock.flowkoBusinessInvite.findMany({ orderBy: { id: "asc" } });
    const usersBefore = await prismock.user.count();

    for (const token of [live.token, live.token, used.token, used.token]) {
      await renderPage(token);
      cleanup();
    }

    expect(await prismock.flowkoBusinessInvite.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await prismock.user.count()).toBe(usersBefore);
  });

  it("a signed-in visitor sees InviteSignedIn (no form, no names) before any lookup or limit", async () => {
    const s = await setUp("Flowko Test");
    const { token } = await addInvite(s);
    signedIn();

    const { container } = await renderPage(token);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Ste že prijavljeni");
    expect(screen.getByTestId("flowko-invite-signed-in").textContent).toContain(
      "Za sprejem povabila se najprej odjavite, nato povezavo odprite znova."
    );
    expect(screen.getByRole("link", { name: "Odjava" }).getAttribute("href")).toBe("/auth/logout");
    expect(screen.queryByRole("textbox")).toBeNull();
    for (const secret of ["Flowko Test", "@", "Hana"]) expect(container.textContent).not.toContain(secret);
    expect(mockLoader).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();

    // the same view whatever the token
    const signedInMarkup = container.innerHTML;
    cleanup();
    const other = await renderPage("short");
    expect(other.container.innerHTML).toBe(signedInMarkup);
  });

  it("limits per IP (30 a minute, core) before the lookup", async () => {
    const s = await setUp("Flowko Test");
    const { token } = await addInvite(s);

    await renderPage(token);

    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledWith({
      rateLimitingType: "core",
      identifier: `flowkoInvitePage:${piiHasher.hash(IP)}`,
      opts: { limit: { limit: 30, duration: "60s" } },
    });
    expect(mockRateLimit.mock.invocationCallOrder[0]).toBeLessThan(mockLoader.mock.invocationCallOrder[0]);
    expect(mockLoader.mock.calls[0][1]).toBe(token);
    expect(mockLoader.mock.calls[0][2]).toBeInstanceOf(Date);
  });

  it("a 429 from the limiter renders the „too many“ view, independent of the token, without a lookup", async () => {
    const s = await setUp("Flowko Test");
    const { token } = await addInvite(s);
    mockRateLimit.mockRejectedValue(new HttpError({ statusCode: 429, message: "Rate limit exceeded." }));

    const { container } = await renderPage(token);

    expect(screen.getByTestId("flowko-invite-too-many").textContent).toBe(
      "Preveč zahtev. Poskusite znova čez trenutek."
    );
    expect(container.textContent).not.toContain("Rate limit exceeded");
    expect(container.textContent).not.toContain("Flowko Test");
    expect(mockLoader).not.toHaveBeenCalled();
    const markup = container.innerHTML;
    cleanup();
    expect((await renderPage("short")).container.innerHTML).toBe(markup);
  });

  it("another limiter failure is not swallowed", async () => {
    mockRateLimit.mockRejectedValue(new Error("limiter down"));
    await expect(renderPage("short")).rejects.toThrow("limiter down");
  });

  it("metadata: fixed path /auth/pridruzi (never the token), noindex, no-referrer", async () => {
    const { generateMetadata } = await import("app/(use-page-wrapper)/auth/pridruzi/[token]/page");
    const metadata = await generateMetadata();

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
    expect(String(metadata.title)).toContain("Povabilo");
    expect(String(metadata.alternates?.canonical)).toMatch(/\/auth\/pridruzi$/);
    expect(String((metadata.openGraph as { url?: unknown } | undefined)?.url)).toMatch(/\/auth\/pridruzi$/);
    expect(generateMetadata.length).toBe(0);
  });
});
