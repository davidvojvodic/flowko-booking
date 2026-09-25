import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getHandler } from "./get.handler";

const mocks = vi.hoisted(() => ({
  findByWebhookId: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@calcom/features/di/webhooks/containers/webhook", () => ({
  getWebhookFeature: () => ({ repository: { findByWebhookId: mocks.findByWebhookId } }),
}));
// The session's JWT, which carries the role validateRole gave it at sign-in
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));

type Row = { id: string; userId: number | null; eventTypeId: number | null; platform: boolean };

// How each kind of webhook is stored. Event type 5 belongs to the tenant (user 1), event type 6 to user 2.
const rows: Row[] = [
  { id: "tenant-own", userId: 1, eventTypeId: null, platform: false },
  { id: "tenant-event-type", userId: null, eventTypeId: 5, platform: false },
  { id: "admin-own", userId: 9, eventTypeId: null, platform: false },
  { id: "other-user", userId: 2, eventTypeId: null, platform: false },
  { id: "other-event-type", userId: null, eventTypeId: 6, platform: false },
  { id: "team-or-app", userId: null, eventTypeId: null, platform: false },
  { id: "platform", userId: null, eventTypeId: null, platform: true },
];
const eventTypeOwner: Record<number, number> = { 5: 1, 6: 2 };

// Just enough of Prisma's where semantics for the filter getHandler builds
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some((w) => matches(row, w));
    if (key === "eventType") {
      const { userId } = value as { userId: number };
      return row.eventTypeId !== null && eventTypeOwner[row.eventTypeId] === userId;
    }
    return row[key as keyof Row] === value;
  });
}

function ctxFor(role: "USER" | "ADMIN" | "WEAK_PASSWORD", { withReq = true } = {}) {
  const isAdmin = role !== "USER";
  mocks.getToken.mockResolvedValue({ role: role === "WEAK_PASSWORD" ? "INACTIVE_ADMIN" : role });
  const user = {
    id: isAdmin ? 9 : 1,
    role: isAdmin ? "ADMIN" : "USER",
    twoFactorEnabled: true,
    identityProvider: "CAL",
  };
  return { user, ...(withReq ? { req: {} } : {}) } as unknown as Parameters<typeof getHandler>[0]["ctx"];
}

describe("webhook getHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.webhook.findFirst.mockImplementation((async ({
      where,
    }: {
      where: Record<string, unknown>;
    }) => {
      const row = rows.find((r) => matches(r, where));
      return row ? { id: row.id } : null;
    }) as never);
    mocks.findByWebhookId.mockImplementation(async (id: string) => ({ id, secret: "s3cret" }));
  });

  it.each(["tenant-own", "tenant-event-type"])("returns the user's own webhook %s", async (id) => {
    await expect(getHandler({ ctx: ctxFor("USER"), input: { id } })).resolves.toMatchObject({ id });
    await expect(getHandler({ ctx: ctxFor("USER"), input: { webhookId: id } })).resolves.toMatchObject({
      id,
    });
  });

  // Platform webhooks receive every tenant's booking events; team and app rows have no user at all
  it.each([
    "other-user",
    "other-event-type",
    "team-or-app",
    "platform",
    "admin-own",
  ])("refuses the user webhook %s", async (id) => {
    await expect(getHandler({ ctx: ctxFor("USER"), input: { id } })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.findByWebhookId).not.toHaveBeenCalled();
  });

  it.each(["admin-own", "platform"])("returns the admin the webhook %s", async (id) => {
    await expect(getHandler({ ctx: ctxFor("ADMIN"), input: { id } })).resolves.toMatchObject({ id });
  });

  it.each(["tenant-own", "team-or-app"])("refuses the admin a webhook that isn't theirs: %s", async (id) => {
    await expect(getHandler({ ctx: ctxFor("ADMIN"), input: { id } })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.findByWebhookId).not.toHaveBeenCalled();
  });

  it("refuses a platform webhook to an admin whose session signed in as INACTIVE_ADMIN", async () => {
    await expect(
      getHandler({ ctx: ctxFor("WEAK_PASSWORD"), input: { id: "platform" } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.findByWebhookId).not.toHaveBeenCalled();
  });

  it("refuses a platform webhook to an admin without a request to read the session from", async () => {
    const ctx = ctxFor("ADMIN", { withReq: false });
    await expect(getHandler({ ctx, input: { id: "platform" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.findByWebhookId).not.toHaveBeenCalled();
  });

  // An id-less filter would match the first row the caller may read, which isn't the one asked for
  it("refuses a lookup without an id", async () => {
    await expect(getHandler({ ctx: ctxFor("ADMIN"), input: {} })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(prismaMock.webhook.findFirst).not.toHaveBeenCalled();
    expect(mocks.findByWebhookId).not.toHaveBeenCalled();
  });
});
