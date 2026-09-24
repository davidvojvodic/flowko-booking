import { beforeEach, describe, expect, it, vi } from "vitest";

import { authedAdminProcedure } from "../procedures/authedProcedure";
import { createCallerFactory, router } from "../trpc";

const mocks = vi.hoisted(() => ({ getUserSession: vi.fn() }));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getUserSession: mocks.getUserSession }));

const adminRouter = router({
  ping: authedAdminProcedure.query(() => "pong"),
});

const createCaller = createCallerFactory(adminRouter);

function callerFor(user: { role: string; twoFactorEnabled: boolean; identityProvider?: string }) {
  const sessionUser = { id: 9, username: "flowko", identityProvider: "CAL", ...user };
  mocks.getUserSession.mockResolvedValue({
    user: sessionUser,
    session: { user: { id: sessionUser.id }, upId: `usr-${sessionUser.id}` },
  });
  return createCaller({} as Parameters<typeof createCaller>[0]);
}

describe("authedAdminProcedure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets an admin with two-factor authentication on through", async () => {
    await expect(callerFor({ role: "ADMIN", twoFactorEnabled: true }).ping()).resolves.toBe("pong");
  });

  // validateRole makes this admin an INACTIVE_ADMIN at sign-in, but the database still says ADMIN
  it("refuses an admin with two-factor authentication off", async () => {
    await expect(callerFor({ role: "ADMIN", twoFactorEnabled: false }).ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("still refuses a user who isn't an admin", async () => {
    await expect(callerFor({ role: "USER", twoFactorEnabled: true }).ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
