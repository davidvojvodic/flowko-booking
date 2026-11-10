// Flowko U25: creating a business and its people. One business = profile + owner (a login user) + workers
// (login users or desk-only placeholders) + staff (receptionist, with or without login) + services with their
// steps + who performs which service. Every function runs through withFlowkoTx: its own transaction on a
// client, the caller's on a transaction client (the set-up script's `--apply` is one transaction).
// Never writes Team, Membership, Host, Profile or EventType (R14); members are created with
// flowkoBusinessMember.create, never through a nested relation write (Teams guard, Ruling 1). Server only.
import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";
import {
  businessProfileSchema,
  // Flowko U29a: the default reminder choice written into a new business.
  DEFAULT_REMINDER_OFFSETS,
  type OpeningHours,
  serviceStepsSchema,
} from "@calcom/lib/flowkoBusiness/schemas";
import { type FlowkoTemplateId, getFlowkoTemplate } from "@calcom/lib/flowkoBusiness/templates";
import type { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus, UserPermissionRole } from "@calcom/prisma/enums";
import { type FlowkoDb, withFlowkoTx } from "./db";
import { makeDeskEmail } from "./deskEmail";
import { FlowkoBusinessError } from "./errors";
import { businessSlugProblem, type SlugProblem } from "./nameSpace";

type Tx = Prisma.TransactionClient;

export type CreateBusinessInput = {
  ownerUserId: number;
  name: string;
  slug: string;
  templateId: FlowkoTemplateId | null;
  phone?: string | null;
  address?: string | null;
  /** Required when templateId is null; overrides the template's hours otherwise. */
  openingHours?: OpeningHours;
};

const BUSINESS_TIME_ZONE = "Europe/Ljubljana";
const DEFAULT_SLOT_GRID_MINUTES = 15;
const DEFAULT_SELF_CANCEL_HOURS = 24;
const DISPLAY_NAME_MAX_LENGTH = 80;

const SLUG_ERRORS: Record<SlugProblem, "name_invalid" | "name_reserved" | "name_taken"> = {
  invalid: "name_invalid",
  reserved: "name_reserved",
  user: "name_taken",
  business: "name_taken",
};

/**
 * A user who may sign in as a member: exists, is not locked, is not an instance ADMIN (design §5: owner rights
 * never come from an instance role) and is not a desk-only placeholder. The lookup opts out of Cal's
 * excludeLockedUsers extension (it adds locked=false unless the where mentions "locked"), so a locked user is
 * found and refused here explicitly (Ruling 8). Returns the member display name: the user's name, else the
 * username.
 */
async function loginUserOrThrow(tx: Tx, userId: number): Promise<{ id: number; displayName: string }> {
  const user = await tx.user.findFirst({
    where: { id: userId, OR: [{ locked: false }, { locked: true }] },
    select: { id: true, name: true, username: true, email: true, locked: true, role: true },
  });
  if (!user || user.locked || user.role === UserPermissionRole.ADMIN || isFlowkoDeskEmail(user.email)) {
    throw new FlowkoBusinessError("bad_member");
  }
  const displayName = user.name?.trim() || user.username?.trim();
  if (!displayName) throw new FlowkoBusinessError("bad_member");
  return { id: user.id, displayName: displayName.slice(0, DISPLAY_NAME_MAX_LENGTH) };
}

async function assertNotAMember(tx: Tx, userId: number): Promise<void> {
  const existing = await tx.flowkoBusinessMember.findFirst({ where: { userId }, select: { id: true } });
  if (existing) throw new FlowkoBusinessError("user_in_business");
}

/** A missing business answers like a foreign one (Flowko convention: same FORBIDDEN). */
async function assertBusinessExists(tx: Tx, businessId: number): Promise<void> {
  const business = await tx.flowkoBusiness.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!business) throw new FlowkoBusinessError("forbidden");
}

// Flowko U29c: exported for addDeskWorker (workers.ts), which validates the name before its duplicate check.
export function displayNameOrThrow(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0 || trimmed.length > DISPLAY_NAME_MAX_LENGTH)
    throw new FlowkoBusinessError("bad_member");
  return trimmed;
}

/**
 * Members are listed in the order they joined. Flowko U29c: takes the business row lock itself (FOR NO KEY UPDATE,
 * so a booking's FOR KEY SHARE FK check never waits behind it; re-taking it in the same transaction is a no-op),
 * so every member creator is serialised, and returns max(position) + 1 (0 when
 * the business has no member), which stays right when the positions are not exactly 0..n-1. The lock is a raw
 * statement: prismock ignores it, real locking is proven in workers.integration-test.ts.
 */
export async function nextPosition(tx: Tx, businessId: number): Promise<number> {
  await tx.$executeRaw`SELECT 1 FROM "FlowkoBusiness" WHERE "id" = ${businessId} FOR NO KEY UPDATE`;
  const last = await tx.flowkoBusinessMember.findFirst({
    where: { businessId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

/**
 * Creates the business, its owner member and (with a template) the template's services in order, each
 * performed by the owner. Refusals: template_unknown, name_invalid / name_reserved / name_taken (shared name
 * space, checked inside the transaction), bad_profile, bad_member (missing, locked, ADMIN or desk-only
 * owner), user_in_business (the owner already belongs to a business).
 */
export async function createBusiness(
  db: FlowkoDb,
  input: CreateBusinessInput
): Promise<{ businessId: number; ownerMemberId: number; serviceIds: number[] }> {
  return withFlowkoTx(db, async (tx) => {
    const template = input.templateId === null ? null : getFlowkoTemplate(input.templateId);
    if (input.templateId !== null && !template) throw new FlowkoBusinessError("template_unknown");

    const slugProblem = await businessSlugProblem(tx, input.slug);
    if (slugProblem) throw new FlowkoBusinessError(SLUG_ERRORS[slugProblem]);

    const openingHours = input.openingHours ?? template?.openingHours;
    if (!openingHours) throw new FlowkoBusinessError("bad_profile");
    const parsed = businessProfileSchema.safeParse({
      name: input.name,
      slug: input.slug,
      phone: input.phone ?? null,
      address: input.address ?? null,
      websiteUrl: null,
      instagramHandle: null,
      brandColor: null,
      darkBrandColor: null,
      openingHours,
      slotGridMinutes: template?.slotGridMinutes ?? DEFAULT_SLOT_GRID_MINUTES,
      showPrices: false,
      selfCancelHours: DEFAULT_SELF_CANCEL_HOURS,
      timeZone: BUSINESS_TIME_ZONE,
    });
    if (!parsed.success) throw new FlowkoBusinessError("bad_profile");
    const profile = parsed.data;

    const services = (template?.services ?? []).map((service) => {
      const steps = serviceStepsSchema.safeParse(service.steps);
      if (!steps.success) throw new FlowkoBusinessError("bad_profile");
      return { ...service, steps: steps.data };
    });

    const owner = await loginUserOrThrow(tx, input.ownerUserId);
    await assertNotAMember(tx, owner.id);

    const business = await tx.flowkoBusiness.create({
      data: {
        name: profile.name,
        slug: profile.slug,
        timeZone: profile.timeZone,
        phone: profile.phone,
        address: profile.address,
        websiteUrl: profile.websiteUrl,
        instagramHandle: profile.instagramHandle,
        brandColor: profile.brandColor,
        darkBrandColor: profile.darkBrandColor,
        openingHours: profile.openingHours,
        slotGridMinutes: profile.slotGridMinutes,
        showPrices: profile.showPrices,
        selfCancelHours: profile.selfCancelHours,
        templateId: template?.id ?? null,
        // Flowko U29a (S1): written explicitly, not left to the column defaults (prismock ignores list defaults).
        reminderOffsets: Array.from(DEFAULT_REMINDER_OFFSETS),
        sharedDevice: false,
      },
      select: { id: true },
    });

    const ownerMember = await tx.flowkoBusinessMember.create({
      data: {
        businessId: business.id,
        userId: owner.id,
        role: FlowkoBusinessRole.OWNER,
        displayName: owner.displayName,
        position: 0,
      },
      select: { id: true },
    });

    const serviceIds: number[] = [];
    for (let position = 0; position < services.length; position++) {
      const service = services[position];
      const created = await tx.flowkoService.create({
        data: {
          businessId: business.id,
          name: service.name,
          category: service.category,
          steps: service.steps,
          priceCents: service.priceCents,
          position,
        },
        select: { id: true },
      });
      await tx.flowkoServiceWorker.create({ data: { serviceId: created.id, memberId: ownerMember.id } });
      serviceIds.push(created.id);
    }

    return { businessId: business.id, ownerMemberId: ownerMember.id, serviceIds };
  });
}

/**
 * Adds an existing login user as WORKER or STAFF (receptionist). Refuses (bad_member) a missing, locked,
 * ADMIN or desk-only user and any other role; user_in_business when the user already belongs to a business;
 * forbidden for a missing business.
 */
export async function addLoginMember(
  db: FlowkoDb,
  businessId: number,
  userId: number,
  role: Exclude<FlowkoBusinessRole, typeof FlowkoBusinessRole.OWNER>
): Promise<{ memberId: number }> {
  return withFlowkoTx(db, async (tx) => {
    if (role !== FlowkoBusinessRole.WORKER && role !== FlowkoBusinessRole.STAFF) {
      throw new FlowkoBusinessError("bad_member");
    }
    await assertBusinessExists(tx, businessId);
    const user = await loginUserOrThrow(tx, userId);
    await assertNotAMember(tx, user.id);
    const member = await tx.flowkoBusinessMember.create({
      data: {
        businessId,
        userId: user.id,
        role,
        displayName: user.displayName,
        position: await nextPosition(tx, businessId),
      },
      select: { id: true },
    });
    return { memberId: member.id };
  });
}

/**
 * A worker with a calendar column but no login or mailbox (R1): a real User (bookings need a user id) with
 * a never-deliverable desk address, no username, no password, Slovene defaults set explicitly (Cal's column
 * defaults are London / 12 h / Sunday), plus a WORKER member.
 */
export async function createDeskOnlyWorker(
  db: FlowkoDb,
  businessId: number,
  displayName: string
): Promise<{ memberId: number; userId: number }> {
  return withFlowkoTx(db, async (tx) => {
    const name = displayNameOrThrow(displayName);
    await assertBusinessExists(tx, businessId);
    const user = await tx.user.create({
      data: {
        email: makeDeskEmail(),
        username: null,
        name,
        timeZone: BUSINESS_TIME_ZONE,
        locale: "sl",
        timeFormat: 24,
        weekStart: "Monday",
        emailVerified: null,
        completedOnboarding: true,
      },
      select: { id: true },
    });
    const member = await tx.flowkoBusinessMember.create({
      data: {
        businessId,
        userId: user.id,
        role: FlowkoBusinessRole.WORKER,
        displayName: name,
        position: await nextPosition(tx, businessId),
      },
      select: { id: true },
    });
    return { memberId: member.id, userId: user.id };
  });
}

/** STAFF without a login (P2: the only member kind with userId NULL). */
export async function addStaffWithoutLogin(
  db: FlowkoDb,
  businessId: number,
  displayName: string
): Promise<{ memberId: number }> {
  return withFlowkoTx(db, async (tx) => {
    const name = displayNameOrThrow(displayName);
    await assertBusinessExists(tx, businessId);
    const member = await tx.flowkoBusinessMember.create({
      data: {
        businessId,
        userId: null,
        role: FlowkoBusinessRole.STAFF,
        displayName: name,
        position: await nextPosition(tx, businessId),
      },
      select: { id: true },
    });
    return { memberId: member.id };
  });
}

/**
 * Replaces who performs a service. Refuses (bad_member) a missing member, a member of another business, a
 * STAFF member (no calendar column) or a LOCKED one; forbidden for a missing service. On a refusal the set is
 * unchanged (all checks run before the first write).
 */
export async function setServiceWorkers(db: FlowkoDb, serviceId: number, memberIds: number[]): Promise<void> {
  return withFlowkoTx(db, async (tx) => {
    const service = await tx.flowkoService.findUnique({
      where: { id: serviceId },
      select: { businessId: true },
    });
    if (!service) throw new FlowkoBusinessError("forbidden");

    const ids = Array.from(new Set(memberIds));
    const members = ids.length
      ? await tx.flowkoBusinessMember.findMany({
          where: { id: { in: ids } },
          select: { id: true, businessId: true, role: true, status: true },
        })
      : [];
    const usable = members.filter(
      (m) =>
        m.businessId === service.businessId &&
        m.role !== FlowkoBusinessRole.STAFF &&
        m.status !== FlowkoMemberStatus.LOCKED
    );
    if (usable.length !== ids.length) throw new FlowkoBusinessError("bad_member");

    await tx.flowkoServiceWorker.deleteMany({ where: { serviceId } });
    for (const memberId of ids) {
      await tx.flowkoServiceWorker.create({ data: { serviceId, memberId } });
    }
  });
}
