// Flowko U27 (E4): Settings → Admin → Users can't move a desk-only user's e-mail off the placeholder domain,
// nor give any user an address on it; the check runs in the mutation body, before any write.
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
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

const targetWithEmail = (email: string) =>
  prismaMock.user.findUnique.mockResolvedValue({
    id: TARGET_ID,
    email,
    username: null,
    movedToProfileId: null,
  } as never);

describe("admin users.update and the desk placeholder domain (Flowko U27 E4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.flowkoBusiness.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(((fn: (tx: typeof prismaMock) => unknown) =>
      fn(prismaMock)) as never);
    prismaMock.user.update.mockImplementation((({ data }: { data: object }) =>
      Promise.resolve({ id: TARGET_ID, ...data })) as never);
  });

  it("refuses moving a desk-only user's e-mail to ana@example.com and writes nothing", async () => {
    targetWithEmail("desk-1@flowko.invalid");
    await expect(adminCaller().update({ userId: TARGET_ID, email: "ana@example.com" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "invalid_email_address",
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses giving a normal user a desk address and writes nothing", async () => {
    targetWithEmail("ana@example.com");
    await expect(
      adminCaller().update({ userId: TARGET_ID, email: "Desk-9@Flowko.Invalid" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "invalid_email_address" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("ordinary changes are unchanged: a normal e-mail change, and an edit that leaves a desk address alone", async () => {
    targetWithEmail("ana@example.com");
    await adminCaller().update({ userId: TARGET_ID, email: "ana2@example.com" });
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);

    prismaMock.user.update.mockClear();
    targetWithEmail("desk-1@flowko.invalid");
    await adminCaller().update({ userId: TARGET_ID, name: "Ana" });
    await adminCaller().update({ userId: TARGET_ID, email: "desk-1@flowko.invalid", name: "Ana" });
    expect(prismaMock.user.update).toHaveBeenCalledTimes(2);
  });
});

describe("admin users.add and the desk placeholder domain (Flowko U27 E4)", () => {
  const newUser = (email: string) => ({
    name: "Host",
    email,
    username: "ana",
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

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.flowkoBusiness.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation((({ data }: { data: object }) =>
      Promise.resolve({ id: 9, ...data })) as never);
  });

  it("refuses an address on @flowko.invalid and writes nothing", async () => {
    await expect(adminCaller().add(newUser("desk-1@flowko.invalid") as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "invalid_email_address",
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("creates a user with an ordinary address", async () => {
    await adminCaller().add(newUser("ana@example.com") as never);
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
  });
});
