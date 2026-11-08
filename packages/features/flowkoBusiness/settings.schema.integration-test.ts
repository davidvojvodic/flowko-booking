// @vitest-environment node
// Flowko U29a: the three business settings columns on a real database (prismock ignores list defaults and
// CHECKs). Proves: a row inserted without the columns gets sharedDevice false, reminderOffsets {1440} and no
// e-mail; reminderOffsets is one of the four U22 choices in their one canonical order and never NULL (CHECK);
// the e-mail is at most 254 characters (CHECK). Runs only with VITEST_MODE=integration against the throwaway DB.

import prisma from "@calcom/prisma";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe("U29a business settings columns on a real database", () => {
  let businessId: number;

  beforeAll(async () => {
    // Raw insert naming none of the three new columns, so only the database defaults fill them.
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      INSERT INTO "FlowkoBusiness" ("name", "slug", "openingHours", "updatedAt")
      VALUES ('Salon settings', ${`settings-${RUN}`}, '{}'::jsonb, now())
      RETURNING "id"`;
    businessId = rows[0].id;
  });

  function setOffsets(offsets: number[]) {
    return prisma.flowkoBusiness.update({ where: { id: businessId }, data: { reminderOffsets: offsets } });
  }

  it("a row inserted without the new columns: chip off, reminder 24 hours before, no e-mail", async () => {
    const business = await prisma.flowkoBusiness.findUniqueOrThrow({
      where: { id: businessId },
      select: { sharedDevice: true, reminderOffsets: true, email: true },
    });
    expect(business).toEqual({ sharedDevice: false, reminderOffsets: [1440], email: null });
  });

  it("accepts the four reminder choices", async () => {
    for (const offsets of [[], [1440], [120], [1440, 120]]) {
      await expect(setOffsets(offsets)).resolves.toMatchObject({ reminderOffsets: offsets });
    }
  });

  it.each([
    [[60]],
    [[1440, 1440]],
    [[120, 1440]],
    [[1440, 120, 60]],
  ])("refuses reminderOffsets %j (CHECK)", async (offsets) => {
    await expect(setOffsets(offsets)).rejects.toThrow(/FlowkoBusiness_reminderOffsets_choice/);
  });

  it("refuses a NULL reminderOffsets (CHECK, the column itself is SQL-nullable)", async () => {
    await expect(
      prisma.$executeRaw`UPDATE "FlowkoBusiness" SET "reminderOffsets" = NULL WHERE "id" = ${businessId}`
    ).rejects.toThrow(/FlowkoBusiness_reminderOffsets_choice/);
  });

  it("refuses a 255-character e-mail and accepts 254 characters (CHECK)", async () => {
    const email254 = `${"a".repeat(64)}@${"b".repeat(186)}.si`;
    expect(email254).toHaveLength(254);
    await expect(
      prisma.flowkoBusiness.update({ where: { id: businessId }, data: { email: `a${email254}` } })
    ).rejects.toThrow(/FlowkoBusiness_email_length/);
    await expect(
      prisma.flowkoBusiness.update({ where: { id: businessId }, data: { email: email254 } })
    ).resolves.toMatchObject({ email: email254 });
    await expect(
      prisma.flowkoBusiness.update({ where: { id: businessId }, data: { email: null } })
    ).resolves.toMatchObject({ email: null });
  });

  it("stores the shared-device switch", async () => {
    await expect(
      prisma.flowkoBusiness.update({ where: { id: businessId }, data: { sharedDevice: true } })
    ).resolves.toMatchObject({ sharedDevice: true });
  });
});
