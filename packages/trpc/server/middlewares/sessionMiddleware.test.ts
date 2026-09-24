import { beforeEach, describe, expect, it, vi } from "vitest";

import { authedAdminProcedure } from "../procedures/authedProcedure";
import { createCallerFactory, router } from "../trpc";

const mocks = vi.hoisted(() => ({ getUserSession: vi.fn(), getToken: vi.fn() }));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getUserSession: mocks.getUserSession }));
// The session's JWT, which carries the role validateRole gave it at sign-in
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));

const adminRouter = router({
  ping: authedAdminProcedure.query(() => "pong"),
});

const createCaller = createCallerFactory(adminRouter);

function callerFor(
  user: { role: string; twoFactorEnabled: boolean; identityProvider?: string },
  signInRole = user.role
) {
  const sessionUser = { id: 9, username: "flowko", identityProvider: "CAL", ...user };
  mocks.getUserSession.mockResolvedValue({
    user: sessionUser,
    session: { user: { id: sessionUser.id }, upId: `usr-${sessionUser.id}` },
  });
  mocks.getToken.mockResolvedValue({ role: signInRole });
  return createCaller({ req: {} } as Parameters<typeof createCaller>[0]);
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

  // An admin with 2FA but a weak password: the database says ADMIN, the JWT says INACTIVE_ADMIN
  it("refuses an admin whose session signed in as INACTIVE_ADMIN", async () => {
    await expect(
      callerFor({ role: "ADMIN", twoFactorEnabled: true }, "INACTIVE_ADMIN").ping()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("still refuses a user who isn't an admin", async () => {
    await expect(callerFor({ role: "USER", twoFactorEnabled: true }).ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
