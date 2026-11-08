// @vitest-environment node
// Flowko U28 (R16 a): listWithTeam's raw UNION query on a real database (prismock's $queryRaw always answers []).
// Olga owns a business: a worker mirror and one ordinary event type; a stranger in no business has one ordinary
// type. listWithTeam, list and getByViewer must show Olga only the ordinary type and leave the stranger as before
// (this also proves `flowkoWorkerMirror: { is: null }` is a valid Prisma filter on Postgres). Runs only with
// VITEST_MODE=integration against the throwaway database.
import { getEventTypesByViewer } from "@calcom/features/eventtypes/lib/getEventTypesByViewer";
import { createBusiness } from "@calcom/features/flowkoBusiness/business";
import { ensureWorkerMirror } from "@calcom/features/flowkoBusiness/mirror";
import prisma from "@calcom/prisma";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { listHandler } from "./list.handler";
import { listWithTeamHandler } from "./listWithTeam.handler";

vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function realUser(name: string): Promise<number> {
  const username = `${name.toLowerCase()}-${RUN}`;
  const user = await prisma.user.create({
    data: {
      email: `${username}@example.com`,
      username,
      name,
      timeZone: "Europe/Ljubljana",
      completedOnboarding: true,
      emailVerified: new Date(),
    },
    select: { id: true },
  });
  return user.id;
}

describe("U28 mirrors out of the owner's lists, on Postgres", () => {
  let olga: number;
  let stranger: number;
  let mirrorEventTypeId: number;
  let olgaOrdinary: number;
  let strangerOrdinary: number;

  beforeAll(async () => {
    olga = await realUser("Olga");
    stranger = await realUser("Stranger");
    const { businessId } = await createBusiness(prisma, {
      ownerUserId: olga,
      name: `Salon Lists ${RUN}`,
      slug: `salon-lists-${RUN}`,
      templateId: "hair-salon",
    });
    const schedule = await prisma.schedule.create({
      data: { user: { connect: { id: olga } }, name: "Delovni čas", timeZone: "Europe/Ljubljana" },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: olga }, data: { defaultScheduleId: schedule.id } });
    olgaOrdinary = (
      await prisma.eventType.create({
        data: { title: "Posvet", slug: `posvet-${RUN}`, length: 30, owner: { connect: { id: olga } } },
        select: { id: true },
      })
    ).id;
    strangerOrdinary = (
      await prisma.eventType.create({
        data: { title: "Tuji", slug: `tuji-${RUN}`, length: 30, owner: { connect: { id: stranger } } },
        select: { id: true },
      })
    ).id;
    const member = await prisma.flowkoBusinessMember.findFirstOrThrow({
      where: { businessId, userId: olga },
      select: { id: true },
    });
    mirrorEventTypeId = (await prisma.$transaction((tx) => ensureWorkerMirror(tx, member.id))).eventTypeId;
  });

  it("positive control: Olga really owns the mirror and the ordinary type", async () => {
    const rows = await prisma.eventType.findMany({ where: { userId: olga }, select: { id: true } });
    expect(rows.map((r) => r.id).sort()).toEqual([mirrorEventTypeId, olgaOrdinary].sort());
  });

  it("listWithTeam shows Olga only the ordinary type", async () => {
    const rows = await listWithTeamHandler({ ctx: { user: { id: olga } } });
    expect(rows.map((r) => r.id)).toEqual([olgaOrdinary]);
    expect(rows[0]).toMatchObject({ team: null, title: "Posvet", length: 30 });
  });

  it("listWithTeam for a user without a mirror is unchanged", async () => {
    const rows = await listWithTeamHandler({ ctx: { user: { id: stranger } } });
    expect(rows.map((r) => r.id)).toEqual([strangerOrdinary]);
  });

  it("list shows Olga only the ordinary type", async () => {
    const rows = await listHandler({ ctx: { user: { id: olga } } as never });
    expect(rows.map((r) => r.id)).toEqual([olgaOrdinary]);
  });

  it("getByViewer shows Olga only the ordinary type; a user without a mirror is unchanged", async () => {
    const ids = (r: Awaited<ReturnType<typeof getEventTypesByViewer>>) =>
      r.eventTypeGroups.flatMap((g) => g.eventTypes.map((e) => e.id));
    expect(ids(await getEventTypesByViewer({ id: olga, profile: { upId: `usr-${olga}` } }))).toEqual([
      olgaOrdinary,
    ]);
    expect(ids(await getEventTypesByViewer({ id: stranger, profile: { upId: `usr-${stranger}` } }))).toEqual([
      strangerOrdinary,
    ]);
  });
});
