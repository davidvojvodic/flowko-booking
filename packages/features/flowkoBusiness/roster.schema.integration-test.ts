// @vitest-environment node
// Flowko U26: the roster tables on a real database (prismock ignores defaults on lists, unique keys, CHECKs and
// foreign-key actions). Proves: business holiday settings default to closed with no open holidays, a member has
// no usual week; one week-change row per member and date (P2002); an absence ends on or after its start and spans
// at most 365 days (CHECK); shifts must be a JSON array (CHECK); deleting a member deletes its day and absence
// rows; deleting the user who wrote a row keeps the row with a NULL author. Business and member are created with
// separate create calls (a nested member create trips the Teams guard's P2). Runs only with VITEST_MODE=integration
// against the throwaway DB.

import prisma from "@calcom/prisma";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DAY = new Date("2026-11-10T00:00:00Z");

async function plainUser(name: string): Promise<number> {
  const username = `${name}-${RUN}`;
  const user = await prisma.user.create({
    data: { email: `${username}@example.com`, username, name },
    select: { id: true },
  });
  return user.id;
}

async function newMember(label: string, userId: number): Promise<number> {
  const business = await prisma.flowkoBusiness.create({
    data: { name: `Salon ${label}`, slug: `${label}-${RUN}`, openingHours: {} },
    select: { id: true },
  });
  const member = await prisma.flowkoBusinessMember.create({
    data: { businessId: business.id, userId, role: FlowkoBusinessRole.OWNER, displayName: label },
    select: { id: true },
  });
  return member.id;
}

function absence(memberId: number, start: string, end: string, createdByUserId?: number) {
  return prisma.flowkoAbsence.create({
    data: {
      memberId,
      startDate: new Date(`${start}T00:00:00Z`),
      endDate: new Date(`${end}T00:00:00Z`),
      createdByUserId,
    },
    select: { id: true },
  });
}

describe("U26 roster schema on a real database", () => {
  let ownerUserId: number;
  let editorUserId: number;
  let memberId: number;
  let businessId: number;

  beforeAll(async () => {
    ownerUserId = await plainUser("roster-owner");
    editorUserId = await plainUser("roster-editor");
    memberId = await newMember("roster", ownerUserId);
    const member = await prisma.flowkoBusinessMember.findUniqueOrThrow({
      where: { id: memberId },
      select: { businessId: true },
    });
    businessId = member.businessId;
  });

  it("business holiday settings default to closed with no open holidays; a member has no usual week", async () => {
    const business = await prisma.flowkoBusiness.findUniqueOrThrow({
      where: { id: businessId },
      select: { holidaysClosed: true, openHolidays: true },
    });
    expect(business).toEqual({ holidaysClosed: true, openHolidays: [] });
    const member = await prisma.flowkoBusinessMember.findUniqueOrThrow({
      where: { id: memberId },
      select: { usualWeek: true },
    });
    expect(member.usualWeek).toBeNull();
  });

  it("a usual week must be a JSON object or NULL (CHECK)", async () => {
    await expect(
      prisma.flowkoBusinessMember.update({ where: { id: memberId }, data: { usualWeek: [] } })
    ).rejects.toThrow(/FlowkoBusinessMember_usualWeek_object/);
    await expect(
      prisma.flowkoBusinessMember.update({ where: { id: memberId }, data: { usualWeek: { mon: [] } } })
    ).resolves.toBeTruthy();
  });

  it("one week-change row per member and date (P2002)", async () => {
    await prisma.flowkoRosterDay.create({ data: { memberId, date: DAY, shifts: [] } });
    await expect(
      prisma.flowkoRosterDay.create({ data: { memberId, date: DAY, shifts: [] } })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("shifts must be a JSON array (CHECK)", async () => {
    await expect(
      prisma.flowkoRosterDay.create({
        data: { memberId, date: new Date("2026-11-11T00:00:00Z"), shifts: {} },
      })
    ).rejects.toThrow(/FlowkoRosterDay_shifts_array/);
  });

  it("an absence ends on or after its start and spans at most 365 days (CHECK)", async () => {
    await expect(absence(memberId, "2026-11-12", "2026-11-11")).rejects.toThrow(/FlowkoAbsence_dates_range/);
    await expect(absence(memberId, "2026-01-01", "2027-01-02")).rejects.toThrow(/FlowkoAbsence_dates_range/);
    await expect(absence(memberId, "2026-01-01", "2027-01-01")).resolves.toMatchObject({
      id: expect.any(Number),
    });
    await expect(absence(memberId, "2026-11-12", "2026-11-12")).resolves.toMatchObject({
      id: expect.any(Number),
    });
  });

  it("deleting the user who wrote a row keeps the row with a NULL author", async () => {
    const editor = await plainUser("roster-writer");
    const day = await prisma.flowkoRosterDay.create({
      data: { memberId, date: new Date("2026-11-13T00:00:00Z"), shifts: [], updatedByUserId: editor },
      select: { id: true },
    });
    const away = await absence(memberId, "2026-12-01", "2026-12-05", editor);
    expect(editor).not.toBe(ownerUserId);

    await prisma.user.delete({ where: { id: editor } });

    await expect(
      prisma.flowkoRosterDay.findUnique({ where: { id: day.id }, select: { updatedByUserId: true } })
    ).resolves.toEqual({ updatedByUserId: null });
    await expect(
      prisma.flowkoAbsence.findUnique({ where: { id: away.id }, select: { createdByUserId: true } })
    ).resolves.toEqual({ createdByUserId: null });
  });

  it("deleting a member deletes its day and absence rows", async () => {
    const otherMemberId = await newMember("roster-gone", editorUserId);
    await prisma.flowkoRosterDay.create({
      data: { memberId: otherMemberId, date: DAY, shifts: [], updatedByUserId: ownerUserId },
    });
    await absence(otherMemberId, "2026-11-20", "2026-11-21", ownerUserId);
    expect(await prisma.flowkoRosterDay.count({ where: { memberId: otherMemberId } })).toBe(1);
    expect(await prisma.flowkoAbsence.count({ where: { memberId: otherMemberId } })).toBe(1);

    await prisma.flowkoBusinessMember.delete({ where: { id: otherMemberId } });

    expect(await prisma.flowkoRosterDay.count({ where: { memberId: otherMemberId } })).toBe(0);
    expect(await prisma.flowkoAbsence.count({ where: { memberId: otherMemberId } })).toBe(0);
  });
});
