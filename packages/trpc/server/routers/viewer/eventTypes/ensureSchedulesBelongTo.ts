import type { PrismaClient } from "@calcom/prisma";
import { TRPCError } from "@trpc/server";

/**
 * Flowko: schedule ids are sequential, and an event type bound to a schedule builds its public slots,
 * availability.user and eventTypes.get's scheduleName from that schedule's working hours, date overrides and
 * timezone. So a write may bind a schedule only to the user who owns it: the caller for an event type's own
 * schedules, the host for a host's schedule. A schedule that does not exist gets the same FORBIDDEN as
 * another user's, so the check does not tell which ids exist.
 */
export async function ensureSchedulesBelongTo(
  prisma: Pick<PrismaClient, "schedule">,
  schedules: { scheduleId: number; userId: number }[]
) {
  if (schedules.length === 0) return;

  const found = await prisma.schedule.findMany({
    where: { id: { in: Array.from(new Set(schedules.map(({ scheduleId }) => scheduleId))) } },
    select: { id: true, userId: true },
  });
  const ownerByScheduleId = new Map(found.map((schedule) => [schedule.id, schedule.userId]));

  if (schedules.some(({ scheduleId, userId }) => ownerByScheduleId.get(scheduleId) !== userId)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}
