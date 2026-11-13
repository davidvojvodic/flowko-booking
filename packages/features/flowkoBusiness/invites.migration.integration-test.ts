// @vitest-environment node
// Flowko U29d: the invite table's revoke state, member link, CHECKs and partial uniques (migration
// 20261112120000_flowko_business_invites) on a real database (prismock ignores CHECKs, unique keys and foreign-key
// actions). Rows are inserted with raw SQL so every refusal is the database's own (23514 / 23505 with the
// constraint name). Proves: role is never OWNER; a member link needs role WORKER; the e-mail is lower case, 3..254
// characters; the name is 1..80 characters; a row is never both used and revoked; tokenHash is 64 lower-case hex
// characters; at most one OPEN (not used, not revoked) invite per business + e-mail and per member; used or revoked
// rows do not block a new open one; the same e-mail may be open in two businesses; deleting the member or the
// business deletes its invites; the migration count is 602. Runs only with VITEST_MODE=integration against the
// throwaway DB (fresh, `prisma migrate deploy`).

import prisma from "@calcom/prisma";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = `${Date.now().toString(36)}${Math.random()
  .toString(36)
  .slice(2, 6)}`;

let seq = 0;
function hash(): string {
  seq += 1;
  return createHash("sha256").update(`${RUN}-${seq}`).digest("hex");
}

type Row = {
  businessId: number;
  email?: string;
  name?: string;
  role?: string;
  memberId?: number | null;
  tokenHash?: string;
  usedAt?: Date | null;
  revokedAt?: Date | null;
};

function insertInvite(row: Row) {
  const email = row.email ?? `p${(seq += 1)}@x.si`;
  const role = row.role ?? "WORKER";
  const name = row.name ?? "Ana";
  const memberId = row.memberId ?? null;
  const tokenHash = row.tokenHash ?? hash();
  const usedAt = row.usedAt ?? null;
  const revokedAt = row.revokedAt ?? null;
  return prisma.$executeRaw`
    INSERT INTO "FlowkoBusinessInvite"
      ("businessId", "email", "name", "role", "tokenHash", "expiresAt", "usedAt", "revokedAt", "memberId", "updatedAt")
    VALUES (${row.businessId}, ${email}, ${name}, ${role}::"FlowkoBusinessRole", ${tokenHash},
      now() + interval '7 days', ${usedAt}, ${revokedAt}, ${memberId}, now())`;
}

async function newBusiness(label: string): Promise<number> {
  const business = await prisma.flowkoBusiness.create({
    data: { name: `Salon ${label}`, slug: `${label}-${RUN}`, openingHours: {} },
    select: { id: true },
  });
  return business.id;
}

// A WORKER member needs a user (CHECK FlowkoBusinessMember_userId_required_unless_staff).
async function newMember(
  businessId: number,
  displayName: string
): Promise<number> {
  seq += 1;
  const username = `inv-member-${seq}-${RUN}`;
  const user = await prisma.user.create({
    data: { email: `${username}@example.com`, username, name: displayName },
    select: { id: true },
  });
  const member = await prisma.flowkoBusinessMember.create({
    data: {
      businessId,
      userId: user.id,
      role: FlowkoBusinessRole.WORKER,
      displayName,
    },
    select: { id: true },
  });
  return member.id;
}

async function count(where: string, ...params: unknown[]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "FlowkoBusinessInvite" WHERE ${where}`,
    ...params
  );
  return Number(rows[0].n);
}

const NOW = new Date("2026-11-16T07:07:00Z");

describe("U29d invite table on a real database", () => {
  let b1: number;
  let b2: number;

  beforeAll(async () => {
    b1 = await newBusiness("inv1");
    b2 = await newBusiness("inv2");
  });

  it("a row inserted without the new columns has no revoke time and no member", async () => {
    const email = `plain-${RUN}@x.si`;
    await insertInvite({ businessId: b1, email });
    const row = await prisma.flowkoBusinessInvite.findFirstOrThrow({
      where: { businessId: b1, email },
    });
    expect(row).toMatchObject({
      revokedAt: null,
      memberId: null,
      role: "WORKER",
      usedAt: null,
    });
  });

  it("the migration is the 602nd and is applied", async () => {
    const rows = await prisma.$queryRaw<{ n: bigint; applied: bigint }[]>`
      SELECT count(*) AS n,
        count(*) FILTER (WHERE "migration_name" = '20261112120000_flowko_business_invites'
          AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) AS applied
      FROM "_prisma_migrations"`;
    expect(Number(rows[0].n)).toBe(602);
    expect(Number(rows[0].applied)).toBe(1);
  });

  describe("role", () => {
    it("refuses OWNER (CHECK)", async () => {
      await expect(
        insertInvite({ businessId: b1, role: "OWNER" })
      ).rejects.toThrow(/23514[\s\S]*FlowkoBusinessInvite_role_not_owner/);
    });

    it("accepts WORKER and STAFF", async () => {
      await expect(
        insertInvite({ businessId: b1, role: "WORKER" })
      ).resolves.toBe(1);
      await expect(
        insertInvite({ businessId: b1, role: "STAFF" })
      ).resolves.toBe(1);
    });

    it("refuses a member link on STAFF (CHECK) and accepts it on WORKER", async () => {
      const memberId = await newMember(b1, "Role member");
      await expect(
        insertInvite({ businessId: b1, role: "STAFF", memberId })
      ).rejects.toThrow(/23514[\s\S]*FlowkoBusinessInvite_member_is_worker/);
      await expect(
        insertInvite({ businessId: b1, role: "WORKER", memberId })
      ).resolves.toBe(1);
    });
  });

  describe("e-mail", () => {
    it("refuses upper case (CHECK)", async () => {
      await expect(
        insertInvite({ businessId: b1, email: "Ana@X.si" })
      ).rejects.toThrow(/23514[\s\S]*FlowkoBusinessInvite_email_lower/);
    });

    it("refuses 2 and 255 characters, accepts 3 and 254", async () => {
      await expect(
        insertInvite({ businessId: b1, email: "a@" })
      ).rejects.toThrow(/FlowkoBusinessInvite_email_lower/);
      const email254 = `${"a".repeat(64)}@${"b".repeat(186)}.si`;
      expect(email254).toHaveLength(254);
      await expect(
        insertInvite({ businessId: b1, email: `a${email254}` })
      ).rejects.toThrow(/FlowkoBusinessInvite_email_lower/);
      await expect(
        insertInvite({ businessId: b1, email: email254 })
      ).resolves.toBe(1);
      await expect(
        insertInvite({ businessId: b1, email: "a@b" })
      ).resolves.toBe(1);
    });
  });

  describe("name", () => {
    it("refuses an empty name and 81 characters (CHECK), accepts 1 and 80", async () => {
      await expect(insertInvite({ businessId: b1, name: "" })).rejects.toThrow(
        /23514[\s\S]*FlowkoBusinessInvite_name_length/
      );
      await expect(
        insertInvite({ businessId: b1, name: "x".repeat(81) })
      ).rejects.toThrow(/FlowkoBusinessInvite_name_length/);
      await expect(insertInvite({ businessId: b1, name: "x" })).resolves.toBe(
        1
      );
      await expect(
        insertInvite({ businessId: b1, name: "ž".repeat(80) })
      ).resolves.toBe(1);
    });
  });

  describe("used or revoked", () => {
    it("refuses a row that is both used and revoked (CHECK), accepts either alone", async () => {
      await expect(
        insertInvite({ businessId: b1, usedAt: NOW, revokedAt: NOW })
      ).rejects.toThrow(/23514[\s\S]*FlowkoBusinessInvite_used_or_revoked/);
      await expect(insertInvite({ businessId: b1, usedAt: NOW })).resolves.toBe(
        1
      );
      await expect(
        insertInvite({ businessId: b1, revokedAt: NOW })
      ).resolves.toBe(1);
    });

    it("refuses an UPDATE that would make an used row also revoked", async () => {
      const email = `ur-${RUN}@x.si`;
      await insertInvite({ businessId: b1, email, usedAt: NOW });
      await expect(
        prisma.$executeRaw`UPDATE "FlowkoBusinessInvite" SET "revokedAt" = ${NOW} WHERE "businessId" = ${b1} AND "email" = ${email}`
      ).rejects.toThrow(/FlowkoBusinessInvite_used_or_revoked/);
    });
  });

  describe("tokenHash", () => {
    it("refuses 63 and 65 characters, upper-case hex and non-hex (CHECK)", async () => {
      const ok = hash();
      for (const bad of [
        ok.slice(0, 63),
        `${ok}a`,
        ok.toUpperCase(),
        `${ok.slice(0, 63)}g`,
        "",
      ]) {
        await expect(
          insertInvite({ businessId: b1, tokenHash: bad })
        ).rejects.toThrow(/23514[\s\S]*FlowkoBusinessInvite_tokenHash_sha256/);
      }
      await expect(
        insertInvite({ businessId: b1, tokenHash: ok })
      ).resolves.toBe(1);
    });

    it("stays unique", async () => {
      const tokenHash = hash();
      await insertInvite({ businessId: b1, tokenHash });
      await expect(insertInvite({ businessId: b2, tokenHash })).rejects.toThrow(
        /23505[\s\S]*FlowkoBusinessInvite_tokenHash_key/
      );
    });
  });

  describe("one open invite per business and e-mail", () => {
    it("refuses a second open row for the same business and e-mail (partial unique), expired or not", async () => {
      const email = `open-${RUN}@x.si`;
      await insertInvite({ businessId: b1, email });
      await expect(insertInvite({ businessId: b1, email })).rejects.toThrow(
        /23505[\s\S]*FlowkoBusinessInvite_one_open_per_email/
      );
      await prisma.$executeRaw`UPDATE "FlowkoBusinessInvite" SET "expiresAt" = now() - interval '1 day' WHERE "businessId" = ${b1} AND "email" = ${email}`;
      await expect(insertInvite({ businessId: b1, email })).rejects.toThrow(
        /FlowkoBusinessInvite_one_open_per_email/
      );
      expect(await count(`"businessId" = $1 AND "email" = $2`, b1, email)).toBe(
        1
      );
    });

    it("a revoked row and an open row for the same e-mail coexist", async () => {
      const email = `rev-${RUN}@x.si`;
      await insertInvite({ businessId: b1, email, revokedAt: NOW });
      await expect(insertInvite({ businessId: b1, email })).resolves.toBe(1);
      await expect(
        insertInvite({ businessId: b1, email, revokedAt: NOW })
      ).resolves.toBe(1);
      expect(await count(`"businessId" = $1 AND "email" = $2`, b1, email)).toBe(
        3
      );
    });

    it("a used row and an open row for the same e-mail coexist", async () => {
      const email = `used-${RUN}@x.si`;
      await insertInvite({ businessId: b1, email, usedAt: NOW });
      await expect(insertInvite({ businessId: b1, email })).resolves.toBe(1);
    });

    it("the same e-mail may be open in two businesses", async () => {
      const email = `both-${RUN}@x.si`;
      await expect(insertInvite({ businessId: b1, email })).resolves.toBe(1);
      await expect(insertInvite({ businessId: b2, email })).resolves.toBe(1);
    });

    it("revoking the open row frees the e-mail (UPDATE, then a new open row)", async () => {
      const email = `free-${RUN}@x.si`;
      await insertInvite({ businessId: b1, email });
      await prisma.$executeRaw`UPDATE "FlowkoBusinessInvite" SET "revokedAt" = ${NOW} WHERE "businessId" = ${b1} AND "email" = ${email}`;
      await expect(insertInvite({ businessId: b1, email })).resolves.toBe(1);
    });
  });

  describe("one open invite per member", () => {
    it("refuses a second open row for the same member under another e-mail (partial unique)", async () => {
      const memberId = await newMember(b1, "Open member");
      await insertInvite({ businessId: b1, memberId });
      await expect(insertInvite({ businessId: b1, memberId })).rejects.toThrow(
        /23505[\s\S]*FlowkoBusinessInvite_one_open_per_member/
      );
    });

    it("revoked and used rows of the member do not block a new open one", async () => {
      const memberId = await newMember(b1, "Closed member");
      await insertInvite({ businessId: b1, memberId, revokedAt: NOW });
      await insertInvite({ businessId: b1, memberId, usedAt: NOW });
      await expect(insertInvite({ businessId: b1, memberId })).resolves.toBe(1);
      expect(await count(`"memberId" = $1`, memberId)).toBe(3);
    });

    it("rows without a member do not collide on memberId (NULL)", async () => {
      await expect(insertInvite({ businessId: b1 })).resolves.toBe(1);
      await expect(insertInvite({ businessId: b1 })).resolves.toBe(1);
    });
  });

  describe("deleting", () => {
    it("deleting the member deletes its invites and leaves the others", async () => {
      const memberId = await newMember(b1, "Gone member");
      const otherMember = await newMember(b1, "Kept member");
      await insertInvite({ businessId: b1, memberId });
      await insertInvite({ businessId: b1, memberId, revokedAt: NOW });
      await insertInvite({ businessId: b1, memberId: otherMember });
      await prisma.flowkoBusinessMember.delete({ where: { id: memberId } });
      expect(await count(`"memberId" = $1`, memberId)).toBe(0);
      expect(await count(`"memberId" = $1`, otherMember)).toBe(1);
    });

    it("deleting the business deletes its invites", async () => {
      const b3 = await newBusiness("inv3");
      await insertInvite({ businessId: b3 });
      await insertInvite({ businessId: b3, revokedAt: NOW });
      await prisma.flowkoBusiness.delete({ where: { id: b3 } });
      expect(await count(`"businessId" = $1`, b3)).toBe(0);
    });

    it("refuses a memberId that names no member (foreign key)", async () => {
      await expect(
        insertInvite({ businessId: b1, memberId: 2147483000 })
      ).rejects.toThrow(/23503[\s\S]*FlowkoBusinessInvite_memberId_fkey/);
    });
  });

  describe("indexes and the Prisma client", () => {
    it("the member index and both partial uniques exist", async () => {
      const rows = await prisma.$queryRaw<
        { indexname: string; indexdef: string }[]
      >`
        SELECT indexname::text AS indexname, indexdef::text AS indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'FlowkoBusinessInvite'`;
      const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
      expect(byName.has("FlowkoBusinessInvite_memberId_idx")).toBe(true);
      expect(byName.get("FlowkoBusinessInvite_one_open_per_email")).toMatch(
        /UNIQUE[\s\S]*\("businessId", email\)[\s\S]*WHERE[\s\S]*"usedAt" IS NULL[\s\S]*"revokedAt" IS NULL/
      );
      expect(byName.get("FlowkoBusinessInvite_one_open_per_member")).toMatch(
        /UNIQUE[\s\S]*\("memberId"\)[\s\S]*WHERE[\s\S]*"memberId" IS NOT NULL[\s\S]*"usedAt" IS NULL[\s\S]*"revokedAt" IS NULL/
      );
    });

    it("the client knows revokedAt, memberId and the member back-relation", async () => {
      const memberId = await newMember(b1, "Client member");
      const created = await prisma.flowkoBusinessInvite.create({
        data: {
          businessId: b1,
          email: `client-${RUN}@x.si`,
          name: "Client",
          tokenHash: hash(),
          expiresAt: new Date(NOW.getTime() + 7 * 24 * 3600 * 1000),
          memberId,
        },
      });
      expect(created).toMatchObject({
        memberId,
        revokedAt: null,
        role: "WORKER",
      });
      const member = await prisma.flowkoBusinessMember.findUniqueOrThrow({
        where: { id: memberId },
        select: { invites: { select: { id: true } } },
      });
      expect(member.invites).toEqual([{ id: created.id }]);
      const revoked = await prisma.flowkoBusinessInvite.update({
        where: { id: created.id },
        data: { revokedAt: NOW },
      });
      expect(revoked.revokedAt).toEqual(NOW);
    });
  });
});
