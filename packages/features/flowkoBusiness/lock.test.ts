// Flowko U25: locking and unlocking a member on prismock. Business A (owner, login workers Ana and Bor, desk-only
// Cene, staff Rok with a login, staff Tea without a login) and B (owner Zala). Covers D1/R6/P3 (member status and
// Cal's User.locked in sync, desk-only and the owner excepted), the order lock-then-disconnect, a failed Google
// disconnect (Review Focus 5), unlock without a mail, and the future-bookings list. Prismock ignores Prisma
// extensions and unique keys: the excludeLockedUsers side is proven in lock.integration-test.ts.
// Flowko U29c (Task 4, W2/W3): lock answers futureCount from the member's mirror (never the worker's private Cal
// bookings) and calls the Google disconnect only for a login member; unlock refuses a member that is not LOCKED
// (member_not_locked, User.locked untouched); a lost lock race is member_conflict. Prismock ignores $executeRaw:
// the worker advisory lock and the member row lock are proven in lock.integration-test.ts.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; lock.ts takes `db` and never imports it.
import "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import {
  futureBookingsOfUser,
  type GoogleDisconnect,
  listFutureBookingsOfMember,
  lockMember,
  setMemberLock,
  unlockMember,
} from "./lock";
import { ensureWorkerMirror } from "./mirror";

// Regression guard (Ruling 4): Cal's admin unlock mails a verification link; Flowko's unlock must send nothing.
const mail = vi.hoisted(() => ({ verification: vi.fn(), transport: vi.fn() }));
vi.mock("@calcom/features/auth/lib/verifyEmail", () => ({ sendEmailVerification: mail.verification }));
vi.mock("nodemailer", () => ({
  createTransport: mail.transport,
  default: { createTransport: mail.transport },
}));

const db = prismock as unknown as FlowkoDb;
const NOW = new Date("2026-11-07T12:00:00Z");
const HOUR = 3_600_000;
let seq = 0;

async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

type Fixture = {
  users: { owner: number; ana: number; bor: number; cene: number; rok: number; zala: number };
  members: { owner: number; ana: number; bor: number; cene: number; rok: number; tea: number; zala: number };
};

async function setUp(): Promise<Fixture> {
  const owner = await makeUser("Owner");
  const a = await createBusiness(db, {
    ownerUserId: owner,
    name: "Salon A",
    slug: "salon-a",
    templateId: "hair-salon",
  });
  const ana = await makeUser("Ana");
  const bor = await makeUser("Bor");
  const rok = await makeUser("Rok");
  const anaMember = await addLoginMember(db, a.businessId, ana, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(db, a.businessId, bor, FlowkoBusinessRole.WORKER);
  const cene = await createDeskOnlyWorker(db, a.businessId, "Cene");
  const rokMember = await addLoginMember(db, a.businessId, rok, FlowkoBusinessRole.STAFF);
  const tea = await addStaffWithoutLogin(db, a.businessId, "Tea");
  const zala = await makeUser("Zala");
  const b = await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: "salon-b",
    templateId: "hair-salon",
  });
  return {
    users: { owner, ana, bor, cene: cene.userId, rok, zala },
    members: {
      owner: a.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      cene: cene.memberId,
      rok: rokMember.memberId,
      tea: tea.memberId,
      zala: b.ownerMemberId,
    },
  };
}

async function memberRow(memberId: number) {
  const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: memberId } });
  if (!member) throw new Error("fixture: no member");
  return member;
}

async function userLocked(userId: number): Promise<boolean> {
  const user = await prismock.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("fixture: no user");
  return user.locked;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(FlowkoBusinessError);
  return (error as FlowkoBusinessError).code;
}

let f: Fixture;

beforeEach(async () => {
  mail.verification.mockReset();
  mail.transport.mockReset();
  f = await setUp();
});

function disconnectReturning(answer: GoogleDisconnect) {
  return vi.fn(async (_userId: number) => answer);
}

// Flowko U29c: the lock failures memberTx answers as member_conflict (memberTx.test.ts pins the matcher itself).
function knownError(code: string, meta: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, { code, clientVersion: "6", meta });
}
function lockFailures() {
  return [
    knownError("P2028", {}),
    knownError("P2034", {}),
    knownError("P2010", { code: "40P01", message: "deadlock detected" }),
    knownError("P2010", {
      driverAdapterError: { cause: { originalCode: "40P01", kind: "postgres", code: "40P01" } },
    }),
  ];
}

describe("lockMember", () => {
  it("the owner locks Ana: member LOCKED with lockedAt, User.locked true, Google disconnected after the write", async () => {
    let memberAtDisconnect: { status: string; locked: boolean } | null = null;
    const disconnectGoogle = vi.fn(async (userId: number): Promise<GoogleDisconnect> => {
      memberAtDisconnect = {
        status: (await memberRow(f.members.ana)).status,
        locked: await userLocked(userId),
      };
      return "disconnected";
    });

    const result = await lockMember({ db, disconnectGoogle }, f.users.owner, f.members.ana, NOW);

    // Flowko U29c: futureCount replaces the user-based list (W2).
    expect(result).toEqual({ status: "LOCKED", google: "disconnected", futureCount: 0 });
    const member = await memberRow(f.members.ana);
    expect(member.status).toBe(FlowkoMemberStatus.LOCKED);
    expect(member.lockedAt).toEqual(NOW);
    expect(await userLocked(f.users.ana)).toBe(true);
    expect(disconnectGoogle).toHaveBeenCalledTimes(1);
    expect(disconnectGoogle).toHaveBeenCalledWith(f.users.ana);
    expect(memberAtDisconnect).toEqual({ status: FlowkoMemberStatus.LOCKED, locked: true });
  });

  it("a desk-only worker: member LOCKED, User.locked stays false (P3), no Google disconnect, google none", async () => {
    // Flowko U29c: a desk-only worker has no Google grants to remove; the disconnect is not called (W2).
    const disconnectGoogle = disconnectReturning("disconnected");
    const result = await lockMember({ db, disconnectGoogle }, f.users.owner, f.members.cene, NOW);

    expect(result).toEqual({ status: "LOCKED", google: "none", futureCount: 0 });
    expect(disconnectGoogle).not.toHaveBeenCalled();
    expect((await memberRow(f.members.cene)).status).toBe(FlowkoMemberStatus.LOCKED);
    expect(await userLocked(f.users.cene)).toBe(false);
  });

  it("staff without a login (no user): LOCKED, google none, no bookings, no disconnect call (Ruling 10)", async () => {
    const disconnectGoogle = disconnectReturning("disconnected");

    const result = await lockMember({ db, disconnectGoogle }, f.users.owner, f.members.tea, NOW);

    expect(result).toEqual({ status: "LOCKED", google: "none", futureCount: 0 });
    expect((await memberRow(f.members.tea)).status).toBe(FlowkoMemberStatus.LOCKED);
    expect(disconnectGoogle).not.toHaveBeenCalled();
  });

  it("the owner can never be locked", async () => {
    const disconnectGoogle = disconnectReturning("none");

    expect(await codeOf(lockMember({ db, disconnectGoogle }, f.users.owner, f.members.owner, NOW))).toBe(
      "owner_cannot_be_locked"
    );
    expect(await codeOf(setMemberLock(db, f.members.owner, true, NOW))).toBe("owner_cannot_be_locked");
    expect((await memberRow(f.members.owner)).status).toBe(FlowkoMemberStatus.ACTIVE);
    expect(await userLocked(f.users.owner)).toBe(false);
    expect(disconnectGoogle).not.toHaveBeenCalled();
  });

  it("a worker or staff as actor is forbidden", async () => {
    for (const actor of [f.users.bor, f.users.rok]) {
      const disconnectGoogle = disconnectReturning("none");
      expect(await codeOf(lockMember({ db, disconnectGoogle }, actor, f.members.ana, NOW))).toBe("forbidden");
      expect(disconnectGoogle).not.toHaveBeenCalled();
    }
    expect((await memberRow(f.members.ana)).status).toBe(FlowkoMemberStatus.ACTIVE);
    expect(await userLocked(f.users.ana)).toBe(false);
  });

  it("the owner of B locking A's member, and a missing member, are forbidden", async () => {
    const disconnectGoogle = disconnectReturning("none");
    expect(await codeOf(lockMember({ db, disconnectGoogle }, f.users.zala, f.members.ana, NOW))).toBe(
      "forbidden"
    );
    expect(await codeOf(lockMember({ db, disconnectGoogle }, f.users.owner, 999999, NOW))).toBe("forbidden");
    expect((await memberRow(f.members.ana)).status).toBe(FlowkoMemberStatus.ACTIVE);
    expect(disconnectGoogle).not.toHaveBeenCalled();
  });

  it("a failed Google disconnect keeps the lock and reports failed (Review Focus 5)", async () => {
    const result = await lockMember(
      { db, disconnectGoogle: disconnectReturning("failed") },
      f.users.owner,
      f.members.ana,
      NOW
    );

    expect(result.google).toBe("failed");
    expect((await memberRow(f.members.ana)).status).toBe(FlowkoMemberStatus.LOCKED);
    expect(await userLocked(f.users.ana)).toBe(true);
  });

  it("locking an already LOCKED member re-runs only the disconnect (lockedAt unchanged)", async () => {
    await lockMember(
      { db, disconnectGoogle: disconnectReturning("failed") },
      f.users.owner,
      f.members.ana,
      NOW
    );
    const later = new Date(NOW.getTime() + HOUR);
    const disconnectGoogle = disconnectReturning("disconnected");

    const result = await lockMember({ db, disconnectGoogle }, f.users.owner, f.members.ana, later);

    expect(result.google).toBe("disconnected");
    expect(disconnectGoogle).toHaveBeenCalledTimes(1);
    const member = await memberRow(f.members.ana);
    expect(member.status).toBe(FlowkoMemberStatus.LOCKED);
    expect(member.lockedAt).toEqual(NOW);
    expect(await userLocked(f.users.ana)).toBe(true);
  });

  // Flowko U29c: the count comes from the member's mirror (C12 privacy): a private Cal booking of the worker on no
  // mirror, a cancelled and a past mirror booking do not count; an ongoing one does (endTime > now).
  it("futureCount counts the holding, not-over bookings on the worker's mirror only (no refusal; A2 lifted)", async () => {
    const mirror = await ensureWorkerMirror(prismock as unknown as Prisma.TransactionClient, f.members.ana);
    const booking = (
      uid: string,
      startOffsetHours: number,
      status: BookingStatus,
      eventTypeId: number | null
    ) =>
      prismock.booking.create({
        data: {
          uid,
          title: "Striženje",
          startTime: new Date(NOW.getTime() + startOffsetHours * HOUR),
          endTime: new Date(NOW.getTime() + (startOffsetHours + 1) * HOUR),
          userId: f.users.ana,
          eventTypeId,
          status,
        },
      });
    await booking("ana-future", 24, BookingStatus.ACCEPTED, mirror.eventTypeId);
    await booking("ana-ongoing", -0.5, BookingStatus.ACCEPTED, mirror.eventTypeId);
    await booking("ana-pending", 30, BookingStatus.PENDING, mirror.eventTypeId);
    await booking("ana-cancelled", 26, BookingStatus.CANCELLED, mirror.eventTypeId);
    await booking("ana-past", -5, BookingStatus.ACCEPTED, mirror.eventTypeId);
    await booking("ana-private", 48, BookingStatus.ACCEPTED, null);

    const result = await lockMember(
      { db, disconnectGoogle: disconnectReturning("none") },
      f.users.owner,
      f.members.ana,
      NOW
    );

    expect(result).toEqual({ status: "LOCKED", google: "none", futureCount: 3 });
    expect(Object.keys(result).sort()).toEqual(["futureCount", "google", "status"]);
  });

  it("a desk-only worker's mirror bookings are counted too", async () => {
    const mirror = await ensureWorkerMirror(prismock as unknown as Prisma.TransactionClient, f.members.cene);
    await prismock.booking.create({
      data: {
        uid: "cene-future",
        title: "Striženje",
        startTime: new Date(NOW.getTime() + 2 * HOUR),
        endTime: new Date(NOW.getTime() + 3 * HOUR),
        userId: f.users.cene,
        eventTypeId: mirror.eventTypeId,
        status: BookingStatus.ACCEPTED,
      },
    });

    const result = await lockMember(
      { db, disconnectGoogle: disconnectReturning("none") },
      f.users.owner,
      f.members.cene,
      NOW
    );
    expect(result).toEqual({ status: "LOCKED", google: "none", futureCount: 1 });
  });

  it("re-locking a LOCKED desk-only worker or staff without a login changes nothing and calls no disconnect", async () => {
    for (const memberId of [f.members.cene, f.members.tea]) {
      const disconnectGoogle = disconnectReturning("disconnected");
      await lockMember({ db, disconnectGoogle }, f.users.owner, memberId, NOW);
      const again = await lockMember(
        { db, disconnectGoogle },
        f.users.owner,
        memberId,
        new Date(NOW.getTime() + HOUR)
      );
      expect(again).toEqual({ status: "LOCKED", google: "none", futureCount: 0 });
      expect(disconnectGoogle).not.toHaveBeenCalled();
      expect((await memberRow(memberId)).lockedAt).toEqual(NOW);
    }
  });

  it("a lost lock race (P2028, P2034, P2010 with 40P01 in both meta forms) is member_conflict, no disconnect", async () => {
    for (const failure of lockFailures()) {
      vi.spyOn(prismock.flowkoBusinessMember, "update").mockRejectedValueOnce(failure);
      const disconnectGoogle = disconnectReturning("disconnected");
      expect(await codeOf(lockMember({ db, disconnectGoogle }, f.users.owner, f.members.ana, NOW))).toBe(
        "member_conflict"
      );
      expect(disconnectGoogle).not.toHaveBeenCalled();
    }
    expect((await memberRow(f.members.ana)).status).toBe(FlowkoMemberStatus.ACTIVE);
    const other = knownError("P2010", { code: "22P02" });
    vi.spyOn(prismock.flowkoBusinessMember, "update").mockRejectedValueOnce(other);
    await expect(
      lockMember({ db, disconnectGoogle: disconnectReturning("none") }, f.users.owner, f.members.ana, NOW)
    ).rejects.toBe(other);
  });
});

describe("setMemberLock", () => {
  it("returns the member and both lock states, and is idempotent", async () => {
    const first = await setMemberLock(db, f.members.ana, true, NOW);
    const second = await setMemberLock(db, f.members.ana, true, new Date(NOW.getTime() + HOUR));

    const expected = { memberId: f.members.ana, userId: f.users.ana, status: "LOCKED", userLocked: true };
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect((await memberRow(f.members.ana)).lockedAt).toEqual(NOW);
  });

  it("desk-only and staff without a login report userLocked false", async () => {
    await expect(setMemberLock(db, f.members.cene, true, NOW)).resolves.toEqual({
      memberId: f.members.cene,
      userId: f.users.cene,
      status: "LOCKED",
      userLocked: false,
    });
    await expect(setMemberLock(db, f.members.tea, true, NOW)).resolves.toEqual({
      memberId: f.members.tea,
      userId: null,
      status: "LOCKED",
      userLocked: false,
    });
  });

  it("a missing member is forbidden", async () => {
    expect(await codeOf(setMemberLock(db, 999999, true, NOW))).toBe("forbidden");
  });
});

describe("unlockMember", () => {
  it("clears both the member status and User.locked, and sends no mail (Task 5 carry, Ruling 4)", async () => {
    await lockMember(
      { db, disconnectGoogle: disconnectReturning("none") },
      f.users.owner,
      f.members.ana,
      NOW
    );
    const mailsBefore = globalThis.testEmails?.length ?? 0;

    await expect(unlockMember(db, f.users.owner, f.members.ana, NOW)).resolves.toEqual({ status: "ACTIVE" });

    const member = await memberRow(f.members.ana);
    expect(member.status).toBe(FlowkoMemberStatus.ACTIVE);
    expect(member.lockedAt).toBeNull();
    expect(await userLocked(f.users.ana)).toBe(false);
    expect(mail.verification).not.toHaveBeenCalled();
    expect(mail.transport).not.toHaveBeenCalled();
    expect(globalThis.testEmails?.length ?? 0).toBe(mailsBefore);
  });

  it("a desk-only worker comes back ACTIVE with User.locked still false", async () => {
    await setMemberLock(db, f.members.cene, true, NOW);
    await expect(unlockMember(db, f.users.owner, f.members.cene, NOW)).resolves.toEqual({ status: "ACTIVE" });
    expect((await memberRow(f.members.cene)).status).toBe(FlowkoMemberStatus.ACTIVE);
    expect(await userLocked(f.users.cene)).toBe(false);
  });

  it("a worker, staff or B's owner is forbidden; the member stays locked", async () => {
    await setMemberLock(db, f.members.ana, true, NOW);
    for (const actor of [f.users.bor, f.users.rok, f.users.zala]) {
      expect(await codeOf(unlockMember(db, actor, f.members.ana, NOW))).toBe("forbidden");
    }
    expect((await memberRow(f.members.ana)).status).toBe(FlowkoMemberStatus.LOCKED);
    expect(await userLocked(f.users.ana)).toBe(true);
  });

  // Flowko U29c (W3, Review Focus 3): unlock is for a LOCKED member only; it never clears a Cal-admin lock.
  it("an ACTIVE member is member_not_locked: nothing written, User.locked untouched", async () => {
    expect(await codeOf(unlockMember(db, f.users.owner, f.members.ana, NOW))).toBe("member_not_locked");
    expect((await memberRow(f.members.ana)).status).toBe(FlowkoMemberStatus.ACTIVE);
    expect(await userLocked(f.users.ana)).toBe(false);
  });

  it("an ACTIVE member whose user a Cal admin locked stays Cal-locked (member_not_locked)", async () => {
    await prismock.user.update({ where: { id: f.users.bor }, data: { locked: true } });

    expect(await codeOf(unlockMember(db, f.users.owner, f.members.bor, NOW))).toBe("member_not_locked");

    expect((await memberRow(f.members.bor)).status).toBe(FlowkoMemberStatus.ACTIVE);
    expect(await userLocked(f.users.bor)).toBe(true);
  });

  it("the owner (always ACTIVE) is member_not_locked", async () => {
    expect(await codeOf(unlockMember(db, f.users.owner, f.members.owner, NOW))).toBe("member_not_locked");
  });

  it("staff without a login: lock and unlock flip only the member row", async () => {
    const users = await prismock.user.findMany({
      select: { id: true, locked: true },
      orderBy: { id: "asc" },
    });

    await lockMember(
      { db, disconnectGoogle: disconnectReturning("none") },
      f.users.owner,
      f.members.tea,
      NOW
    );
    expect((await memberRow(f.members.tea)).status).toBe(FlowkoMemberStatus.LOCKED);
    await expect(unlockMember(db, f.users.owner, f.members.tea, NOW)).resolves.toEqual({ status: "ACTIVE" });

    const member = await memberRow(f.members.tea);
    expect(member.status).toBe(FlowkoMemberStatus.ACTIVE);
    expect(member.lockedAt).toBeNull();
    expect(
      await prismock.user.findMany({ select: { id: true, locked: true }, orderBy: { id: "asc" } })
    ).toEqual(users);
  });

  it("a missing member or another business's member is forbidden before the status check", async () => {
    expect(await codeOf(unlockMember(db, f.users.owner, 999999, NOW))).toBe("forbidden");
    expect(await codeOf(unlockMember(db, f.users.owner, f.members.zala, NOW))).toBe("forbidden");
  });

  it("a lost lock race (P2028, P2034, P2010 with 40P01 in both meta forms) is member_conflict, still LOCKED", async () => {
    await setMemberLock(db, f.members.ana, true, NOW);
    for (const failure of lockFailures()) {
      vi.spyOn(prismock.flowkoBusinessMember, "update").mockRejectedValueOnce(failure);
      expect(await codeOf(unlockMember(db, f.users.owner, f.members.ana, NOW))).toBe("member_conflict");
    }
    expect((await memberRow(f.members.ana)).status).toBe(FlowkoMemberStatus.LOCKED);
    expect(await userLocked(f.users.ana)).toBe(true);
  });
});

describe("futureBookingsOfUser and listFutureBookingsOfMember", () => {
  async function booking(uid: string, startOffsetHours: number, status: BookingStatus, userId = f.users.ana) {
    return prismock.booking.create({
      data: {
        uid,
        title: uid,
        startTime: new Date(NOW.getTime() + startOffsetHours * HOUR),
        endTime: new Date(NOW.getTime() + (startOffsetHours + 1) * HOUR),
        userId,
        status,
      },
    });
  }

  it("lists the future ACCEPTED, PENDING and AWAITING_HOST bookings sorted by start; past, cancelled, rejected and others' left out", async () => {
    const later = await booking("later", 48, BookingStatus.ACCEPTED);
    const pending = await booking("pending", 5, BookingStatus.PENDING);
    const ongoing = await booking("ongoing", -0.5, BookingStatus.ACCEPTED);
    const awaiting = await booking("awaiting", 30, BookingStatus.AWAITING_HOST);
    await booking("past", -5, BookingStatus.ACCEPTED);
    await booking("cancelled", 10, BookingStatus.CANCELLED);
    await booking("rejected", 11, BookingStatus.REJECTED);
    await booking("bors", 12, BookingStatus.ACCEPTED, f.users.bor);

    const list = await futureBookingsOfUser(db, f.users.ana, NOW);

    expect(list.map((b) => b.uid)).toEqual(["ongoing", "pending", "awaiting", "later"]);
    expect(list[1]).toEqual({
      id: pending.id,
      uid: "pending",
      startTime: pending.startTime,
      endTime: pending.endTime,
      status: BookingStatus.PENDING,
    });
    expect([ongoing.id, awaiting.id, later.id]).toEqual([list[0].id, list[2].id, list[3].id]);
  });

  it("listFutureBookingsOfMember: the owner gets the same list; a worker or B's owner is forbidden", async () => {
    await booking("one", 5, BookingStatus.ACCEPTED);
    await booking("two", 2, BookingStatus.PENDING);

    const direct = await futureBookingsOfUser(db, f.users.ana, NOW);
    await expect(listFutureBookingsOfMember(db, f.users.owner, f.members.ana, NOW)).resolves.toEqual(direct);
    expect(direct).toHaveLength(2);
    for (const actor of [f.users.bor, f.users.rok, f.users.zala]) {
      expect(await codeOf(listFutureBookingsOfMember(db, actor, f.members.ana, NOW))).toBe("forbidden");
    }
  });

  it("listFutureBookingsOfMember: staff without a login has none", async () => {
    await expect(listFutureBookingsOfMember(db, f.users.owner, f.members.tea, NOW)).resolves.toEqual([]);
  });
});
