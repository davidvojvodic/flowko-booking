// Flowko U29a: the owner's service catalogue (S8–S13). List the services with who does them and how many future
// bookings use them; save one (name, category, steps, who does it; price, online flag and grid are never touched);
// remove one (a hard delete: bookings keep their own step copy, FlowkoBookingStep.serviceId → NULL by the FK);
// reorder them. Editing or removing a service never changes an existing booking (design §6, U27 copy rule). Who
// does it: only ACTIVE OWNER/WORKER members may be named; a LOCKED member's stored assignment is kept and never
// added or removed by a save (the lock keeps assignments; the editor shows them disabled). Names are unique per
// business case-insensitively (Slovene lower case), checked in the save's transaction; a parallel save with the
// same exact name hits FlowkoService_businessId_name_key (P2002) and gets the same service_name_taken. Owner only
// (forbidden otherwise; another business's or an unknown service id answers forbidden). Server only.
import { serviceInputSchema, serviceStepsSchema } from "@calcom/lib/flowkoBusiness/schemas";
import { type ServiceStep, totalMinutes } from "@calcom/lib/flowkoSalon";
import { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import type { z } from "zod";
import { listMembers, mayManageBusiness, requireBusinessAccess } from "./access";
import { HOLDING_STATUSES } from "./bookingDay";
import { type FlowkoDb, withFlowkoTx } from "./db";
import { FlowkoBusinessError } from "./errors";

type Tx = Prisma.TransactionClient;

const COLUMN_ROLES: FlowkoBusinessRole[] = [FlowkoBusinessRole.OWNER, FlowkoBusinessRole.WORKER];
const MAX_INT4 = 2_147_483_647;
/** The unique index a parallel save with the same exact name violates. */
const NAME_UNIQUE_INDEX = "FlowkoService_businessId_name_key";

/** A column member (OWNER/WORKER, ACTIVE or LOCKED) as the editor's "who does it" list shows it. */
export type ServiceColumnMember = {
  memberId: number;
  displayName: string;
  role: FlowkoBusinessRole;
  status: FlowkoMemberStatus;
  deskOnly: boolean;
};
export type OwnerServiceWorker = {
  memberId: number;
  displayName: string;
  status: FlowkoMemberStatus;
  deskOnly: boolean;
  /** Does this service now (a LOCKED member's assignment stays as it is). */
  assigned: boolean;
};
export type OwnerService = {
  id: number;
  name: string;
  category: string | null;
  steps: ServiceStep[];
  totalMinutes: number;
  position: number;
  /** Every column member in roster order with whether they do this service. */
  workers: OwnerServiceWorker[];
  /** Business bookings in a holding status ending after now with a step of this service. */
  futureBookings: number;
};
export type OwnerServicesView = { services: OwnerService[]; members: ServiceColumnMember[] };

export type SaveServiceInput = z.input<typeof serviceInputSchema>;

/** The business of an ACTIVE owner, else forbidden. */
async function requireOwner(db: FlowkoDb, userId: number): Promise<number> {
  const access = await requireBusinessAccess(db, userId);
  if (!mayManageBusiness(access)) throw new FlowkoBusinessError("forbidden");
  return access.businessId;
}

/** A value Postgres can hold as an Int id (a larger number would make Prisma throw instead of answering). */
function isDbId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_INT4;
}

/** S8: the comparison key of a service name (case-insensitive, Slovene letters included). */
function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase("sl");
}

/** S14: the services of the owner's business in position order, the column members and the future bookings. */
export async function listServicesForOwner(
  db: FlowkoDb,
  userId: number,
  now: Date
): Promise<OwnerServicesView> {
  const businessId = await requireOwner(db, userId);
  const members: ServiceColumnMember[] = (await listMembers(db, businessId))
    .filter((m) => COLUMN_ROLES.includes(m.role))
    .map((m) => ({
      memberId: m.memberId,
      displayName: m.displayName,
      role: m.role,
      status: m.status,
      deskOnly: m.deskOnly,
    }));
  const services = await db.flowkoService.findMany({
    where: { businessId },
    select: { id: true, name: true, category: true, steps: true, position: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  // Through the relation, never `serviceId: { in }` (prismock returns nothing for `in` on this composite key).
  const assignments = await db.flowkoServiceWorker.findMany({
    where: { service: { businessId } },
    select: { serviceId: true, memberId: true },
  });
  const futureBookings = await countFutureBookings(db, businessId, now);

  return {
    services: services.map((s) => {
      // U24 rules only: the S9 caps apply to a save, never to a stored service.
      const steps = serviceStepsSchema.safeParse(s.steps);
      // Stored steps are validated on write; a failure here is corrupt data (as listDeskServices).
      if (!steps.success) throw new Error("Flowko U29a: stored service steps invalid");
      const parsed = steps.data;
      const assigned = new Set(assignments.filter((a) => a.serviceId === s.id).map((a) => a.memberId));
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        steps: parsed,
        totalMinutes: totalMinutes(parsed),
        position: s.position,
        workers: members.map((m) => ({
          memberId: m.memberId,
          displayName: m.displayName,
          status: m.status,
          deskOnly: m.deskOnly,
          assigned: assigned.has(m.memberId),
        })),
        futureBookings: futureBookings.get(s.id) ?? 0,
      };
    }),
    members,
  };
}

/** Per service id: the business's holding bookings ending after `now` with at least one step of that service. */
async function countFutureBookings(
  db: FlowkoDb,
  businessId: number,
  now: Date
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const mirrors = await db.flowkoWorkerMirror.findMany({
    where: { businessId },
    select: { eventTypeId: true },
  });
  if (mirrors.length === 0) return counts;
  const bookings = await db.booking.findMany({
    where: {
      eventTypeId: { in: mirrors.map((m) => m.eventTypeId) },
      status: { in: HOLDING_STATUSES },
      endTime: { gt: now },
    },
    select: { flowkoBookingSteps: { select: { serviceId: true } } },
  });
  for (const booking of bookings) {
    const ids = new Set<number>();
    for (const step of booking.flowkoBookingSteps) if (step.serviceId !== null) ids.add(step.serviceId);
    for (const id of Array.from(ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** A valid save input, or bad_service (bad_member when only the worker list is wrong). */
function parseInput(input: SaveServiceInput) {
  const parsed = serviceInputSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const onlyWorkers = parsed.error.issues.every((issue) => issue.path[0] === "workerMemberIds");
  throw new FlowkoBusinessError(onlyWorkers ? "bad_member" : "bad_service");
}

/**
 * S10: `memberIds` (each once) are ACTIVE OWNER/WORKER members of the business, else bad_member (STAFF, LOCKED,
 * another business's, unknown).
 */
async function assertActiveColumnMembers(tx: Tx, businessId: number, memberIds: number[]): Promise<void> {
  if (memberIds.length === 0) return;
  if (!memberIds.every(isDbId)) throw new FlowkoBusinessError("bad_member");
  const members = await tx.flowkoBusinessMember.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, businessId: true, role: true, status: true },
  });
  const usable = members.filter(
    (m) =>
      m.businessId === businessId && COLUMN_ROLES.includes(m.role) && m.status === FlowkoMemberStatus.ACTIVE
  );
  if (usable.length !== memberIds.length) throw new FlowkoBusinessError("bad_member");
}

/**
 * S10: sets who does a service of the business. `memberIds` may name only ACTIVE OWNER/WORKER members
 * (bad_member otherwise); assignments of ACTIVE members not named are removed, named ones added; a stored LOCKED
 * member's assignment is always kept. A service of another business (or none) is forbidden. All checks run before
 * the first write. No owner check (the callers check it); `setServiceWorkers` (business.ts) stays the admin tool.
 */
export async function setServiceWorkersKeepingLocked(
  tx: Tx,
  businessId: number,
  serviceId: number,
  memberIds: number[]
): Promise<void> {
  if (!isDbId(serviceId)) throw new FlowkoBusinessError("forbidden");
  const service = await tx.flowkoService.findUnique({
    where: { id: serviceId },
    select: { businessId: true },
  });
  if (!service || service.businessId !== businessId) throw new FlowkoBusinessError("forbidden");
  const wanted = Array.from(new Set(memberIds));
  await assertActiveColumnMembers(tx, businessId, wanted);

  // Through the relation (prismock, see listServicesForOwner); the member's status decides what a save may touch.
  const stored = await tx.flowkoServiceWorker.findMany({
    where: { serviceId, service: { businessId } },
    select: { memberId: true, member: { select: { status: true } } },
  });
  const storedIds = stored.map((a) => a.memberId);
  const removed = stored
    .filter((a) => a.member.status !== FlowkoMemberStatus.LOCKED && !wanted.includes(a.memberId))
    .map((a) => a.memberId);
  for (const memberId of removed) {
    await tx.flowkoServiceWorker.deleteMany({ where: { serviceId, memberId } });
  }
  for (const memberId of wanted) {
    if (!storedIds.includes(memberId)) await tx.flowkoServiceWorker.create({ data: { serviceId, memberId } });
  }
}

/** P2002 on the (businessId, name) unique index: a parallel save took the exact name first. */
function isNameClash(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const meta = JSON.stringify(e.meta ?? {});
  return meta.includes(NAME_UNIQUE_INDEX) || (meta.includes('"name"') && meta.includes("businessId"));
}

/**
 * Flowko U29a: P2025 (record to update or delete not found): another device removed the service between this
 * transaction's read and its write. The caller answers as for an unknown service.
 */
function isServiceGone(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}

/**
 * S8, S9, S13: creates (no `id`; placed last, max(position) + 1) or edits (`id`) a service of the owner's business:
 * name, category, steps and who does it. Price, online flag, grid and position are never written by an edit.
 * Existing bookings keep their step copies.
 */
export async function saveService(
  db: FlowkoDb,
  actorUserId: number,
  input: SaveServiceInput
): Promise<{ serviceId: number }> {
  const businessId = await requireOwner(db, actorUserId);
  const service = parseInput(input);
  if (service.id !== undefined && !isDbId(service.id)) throw new FlowkoBusinessError("forbidden");

  try {
    return await withFlowkoTx(db, async (tx) => {
      const others = await tx.flowkoService.findMany({
        where: { businessId },
        select: { id: true, name: true, position: true },
      });
      if (service.id !== undefined && !others.some((s) => s.id === service.id)) {
        throw new FlowkoBusinessError("forbidden");
      }
      const key = nameKey(service.name);
      if (others.some((s) => s.id !== service.id && nameKey(s.name) === key)) {
        throw new FlowkoBusinessError("service_name_taken");
      }
      // Before the first write, so a refused list writes nothing on any client.
      await assertActiveColumnMembers(tx, businessId, service.workerMemberIds);

      let serviceId: number;
      if (service.id !== undefined) {
        serviceId = service.id;
        await tx.flowkoService.update({
          where: { id: serviceId },
          data: { name: service.name, category: service.category, steps: service.steps },
        });
      } else {
        const position = others.reduce((max, s) => Math.max(max, s.position + 1), 0);
        const created = await tx.flowkoService.create({
          data: {
            businessId,
            name: service.name,
            category: service.category,
            steps: service.steps,
            position,
          },
          select: { id: true },
        });
        serviceId = created.id;
      }
      await setServiceWorkersKeepingLocked(tx, businessId, serviceId, service.workerMemberIds);
      return { serviceId };
    });
  } catch (e) {
    if (isNameClash(e)) throw new FlowkoBusinessError("service_name_taken");
    if (isServiceGone(e)) throw new FlowkoBusinessError("forbidden");
    throw e;
  }
}

/**
 * S12: removes a service of the owner's business (hard delete; who does it goes with it by the FK cascade).
 * Bookings using it keep their step copy: the FK sets their steps' serviceId to NULL, the name stays.
 */
export async function removeService(db: FlowkoDb, actorUserId: number, serviceId: number): Promise<void> {
  const businessId = await requireOwner(db, actorUserId);
  if (!isDbId(serviceId)) throw new FlowkoBusinessError("forbidden");
  try {
    await withFlowkoTx(db, async (tx) => {
      const service = await tx.flowkoService.findUnique({
        where: { id: serviceId },
        select: { businessId: true },
      });
      if (!service || service.businessId !== businessId) throw new FlowkoBusinessError("forbidden");
      await tx.flowkoService.delete({ where: { id: serviceId } });
    });
  } catch (e) {
    if (isServiceGone(e)) throw new FlowkoBusinessError("forbidden");
    throw e;
  }
}

/**
 * S13: `serviceIds` must be exactly the business's services, each once (else bad_service: a stale list after
 * another device added or removed one, or a foreign id); positions are rewritten 0..n−1 in that order.
 */
export async function reorderServices(
  db: FlowkoDb,
  actorUserId: number,
  serviceIds: number[]
): Promise<void> {
  const businessId = await requireOwner(db, actorUserId);
  if (!Array.isArray(serviceIds) || !serviceIds.every(isDbId)) throw new FlowkoBusinessError("bad_service");
  try {
    await withFlowkoTx(db, async (tx) => {
      const stored = await tx.flowkoService.findMany({ where: { businessId }, select: { id: true } });
      const storedIds = stored.map((s) => s.id);
      const exact =
        serviceIds.length === storedIds.length &&
        new Set(serviceIds).size === serviceIds.length &&
        serviceIds.every((id) => storedIds.includes(id));
      if (!exact) throw new FlowkoBusinessError("bad_service");
      for (let position = 0; position < serviceIds.length; position += 1) {
        await tx.flowkoService.update({ where: { id: serviceIds[position] }, data: { position } });
      }
    });
  } catch (e) {
    // Flowko U29a: a service removed meanwhile on another device is a stale list, as above.
    if (isServiceGone(e)) throw new FlowkoBusinessError("bad_service");
    throw e;
  }
}
