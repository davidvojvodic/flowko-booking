// Flowko U25: Settings → Admin → Users (add, edit) can't give a user a name a business holds; the check runs
// in the mutation body, before any write.
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { RESERVED_USERNAME_MESSAGE } from "@calcom/features/auth/signup/utils/reservedUsernames";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../../../trpc";
import { userAdminRouter } from "./_router";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  isActiveInstanceAdminSession: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("@calcom/features/auth/lib/isActiveInstanceAdmin", () => ({
  isActiveInstanceAdminSession: mocks.isActiveInstanceAdminSession,
}));

const createCaller = createCallerFactory(userAdminRouter);

const ADMIN_ID = 1;
const TARGET_ID = 2;

function adminCaller() {
  mocks.getUserSession.mockResolvedValue({
    user: { id: ADMIN_ID, role: "ADMIN", username: "admin" },
    session: { user: { id: ADMIN_ID }, upId: `usr-${ADMIN_ID}` },
  });
  mocks.isActiveInstanceAdminSession.mockResolvedValue(true);
  return createCaller({ prisma: prismaMock } as unknown as Parameters<typeof createCaller>[0]);
}

const newUser = (username: string) => ({
  name: "Host",
  email: "host@example.com",
  username,
  bio: null,
  timeZone: "Europe/Ljubljana",
  weekStart: "Monday",
  theme: null,
  defaultScheduleId: null,
  locale: "sl",
  timeFormat: 24,
  allowDynamicBooking: false,
  identityProvider: "CAL" as const,
  role: "USER" as const,
  avatarUrl: null,
});

describe("admin users add/update refuse a business's slug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.flowkoBusiness.findFirst.mockImplementation((({ where }: { where: { slug: string } }) =>
      Promise.resolve(where.slug === "studio" ? { id: 3 } : null)) as never);
    prismaMock.user.create.mockImplementation((({ data }: { data: object }) =>
      Promise.resolve({ id: 9, ...data })) as never);
    prismaMock.user.findUnique.mockResolvedValue({
      id: TARGET_ID,
      username: "old",
      movedToProfileId: null,
    } as never);
    prismaMock.$transaction.mockImplementation(((fn: (tx: typeof prismaMock) => unknown) =>
      fn(prismaMock)) as never);
    prismaMock.user.update.mockImplementation((({ data }: { data: object }) =>
      Promise.resolve({ id: TARGET_ID, ...data })) as never);
    prismaMock.profile.updateMany.mockResolvedValue({ count: 0 });
  });

  it("add: refuses Studio while business studio exists and writes nothing", async () => {
    await expect(adminCaller().add(newUser("Studio") as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: RESERVED_USERNAME_MESSAGE,
    });
    expect(prismaMock.flowkoBusiness.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "studio" } })
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("add: creates a user with another username", async () => {
    await expect(adminCaller().add(newUser("ana") as never)).resolves.toMatchObject({
      user: { id: 9, username: "ana" },
    });
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
  });

  it("update: refuses Studio while business studio exists and writes nothing", async () => {
    await expect(
      adminCaller().update({ userId: TARGET_ID, username: "Studio" } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: RESERVED_USERNAME_MESSAGE });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.profile.updateMany).not.toHaveBeenCalled();
  });

  it("update: renames to another username", async () => {
    await expect(
      adminCaller().update({ userId: TARGET_ID, username: "ana" } as never)
    ).resolves.toMatchObject({
      user: { id: TARGET_ID, username: "ana" },
    });
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
  });

  it("update: an edit without a username skips the lookup", async () => {
    await adminCaller().update({ userId: TARGET_ID, name: "Host" } as never);
    expect(prismaMock.flowkoBusiness.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
  });
});
