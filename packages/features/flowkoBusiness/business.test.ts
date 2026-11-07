// Flowko U25: the business-create service (business + owner + desk-only workers + staff + services + who
// does what) on prismock. Unique keys, the lock extension and rollback are proven on the throwaway DB (Task 6),
// not here: prismock ignores them, so every refusal below is checked before any write.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; the services take `db` and never import it.
import "@calcom/prisma";
import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";
import { FLOWKO_TEMPLATES } from "@calcom/lib/flowkoBusiness/templates";
import { FlowkoBusinessRole, FlowkoMemberStatus, UserPermissionRole } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addLoginMember,
  addStaffWithoutLogin,
  createBusiness,
  createDeskOnlyWorker,
  setServiceWorkers,
} from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { businessSlugProblem } from "./nameSpace";

vi.mock("./nameSpace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nameSpace")>();
  return { ...actual, businessSlugProblem: vi.fn(actual.businessSlugProblem) };
});

const db = prismock as unknown as FlowkoDb;
const template = FLOWKO_TEMPLATES["hair-salon"];
let seq = 0;

async function makeUser(data: Record<string, unknown> = {}): Promise<{ id: number }> {
  seq += 1;
  return prismock.user.create({
    data: { email: `person${seq}@example.com`, username: `person${seq}`, name: `Person ${seq}`, ...data },
    select: { id: true },
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(FlowkoBusinessError);
  expect((error as FlowkoBusinessError).code).toBe(code);
  expect((error as FlowkoBusinessError).message).toBe(code);
}

async function makeBusiness(
  slug = "salon-ana"
): Promise<{ businessId: number; ownerMemberId: number; serviceIds: number[] }> {
  const owner = await makeUser();
  return createBusiness(db, { ownerUserId: owner.id, name: "Salon Ana", slug, templateId: "hair-salon" });
}

beforeEach(() => {
  vi.mocked(businessSlugProblem).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBusiness", () => {
  it("creates the business, the owner and the six template services assigned to the owner", async () => {
    const owner = await makeUser({ name: "Ana Novak" });

    const result = await createBusiness(db, {
      ownerUserId: owner.id,
      name: "  Salon Ana  ",
      slug: "salon-ana",
      templateId: "hair-salon",
      phone: "+386 41 123 456",
    });

    const businesses = await prismock.flowkoBusiness.findMany();
    expect(businesses).toHaveLength(1);
    expect(businesses[0]).toMatchObject({
      id: result.businessId,
      name: "Salon Ana",
      slug: "salon-ana",
      templateId: "hair-salon",
      timeZone: "Europe/Ljubljana",
      phone: "+386 41 123 456",
      address: null,
      slotGridMinutes: 15,
      showPrices: false,
      selfCancelHours: 24,
      brandColor: null,
      darkBrandColor: null,
    });
    expect(businesses[0].openingHours).toEqual(template.openingHours);

    const members = await prismock.flowkoBusinessMember.findMany();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      id: result.ownerMemberId,
      businessId: result.businessId,
      userId: owner.id,
      role: FlowkoBusinessRole.OWNER,
      status: FlowkoMemberStatus.ACTIVE,
      displayName: "Ana Novak",
    });

    const services = await prismock.flowkoService.findMany({ orderBy: { position: "asc" } });
    expect(services.map((s) => s.id)).toEqual(result.serviceIds);
    expect(
      services.map((s) => ({
        name: s.name,
        category: s.category,
        steps: s.steps,
        priceCents: s.priceCents,
        position: s.position,
        businessId: s.businessId,
      }))
    ).toEqual(
      template.services.map((s, i) => ({
        name: s.name,
        category: s.category,
        steps: s.steps,
        priceCents: null,
        position: i,
        businessId: result.businessId,
      }))
    );

    const links = await prismock.flowkoServiceWorker.findMany();
    expect(links).toHaveLength(6);
    expect(new Set(links.map((l) => l.serviceId))).toEqual(new Set(result.serviceIds));
    expect(links.every((l) => l.memberId === result.ownerMemberId)).toBe(true);
  });

  it("checks the slug inside the transaction it runs in", async () => {
    await makeBusiness("salon-ana");
    expect(businessSlugProblem).toHaveBeenCalledWith(expect.anything(), "salon-ana");
  });

  it("names the owner after the username when the user has no name", async () => {
    const owner = await makeUser({ name: null, username: "ana" });
    const { ownerMemberId } = await createBusiness(db, {
      ownerUserId: owner.id,
      name: "Salon Ana",
      slug: "salon-ana",
      templateId: "hair-salon",
    });
    const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: ownerMemberId } });
    expect(member?.displayName).toBe("ana");
  });

  it("creates a business without a template from the given opening hours (no services)", async () => {
    const owner = await makeUser();
    const result = await createBusiness(db, {
      ownerUserId: owner.id,
      name: "Studio",
      slug: "studio-nina",
      templateId: null,
      openingHours: template.openingHours,
    });
    expect(result.serviceIds).toEqual([]);
    const business = await prismock.flowkoBusiness.findUnique({ where: { id: result.businessId } });
    expect(business?.templateId).toBeNull();
    expect(await prismock.flowkoService.count()).toBe(0);
  });

  it("refuses a business without a template and without opening hours (bad_profile)", async () => {
    const owner = await makeUser();
    await expectCode(
      createBusiness(db, { ownerUserId: owner.id, name: "Studio", slug: "studio-nina", templateId: null }),
      "bad_profile"
    );
    expect(await prismock.flowkoBusiness.count()).toBe(0);
  });

  it("refuses an unknown template", async () => {
    const owner = await makeUser();
    await expectCode(
      createBusiness(db, {
        ownerUserId: owner.id,
        name: "Studio",
        slug: "studio-nina",
        templateId: "nail-bar" as never,
      }),
      "template_unknown"
    );
    expect(await prismock.flowkoBusiness.count()).toBe(0);
  });

  it.each([
    ["user", "name_taken"],
    ["business", "name_taken"],
    ["reserved", "name_reserved"],
    ["invalid", "name_invalid"],
  ] as const)("maps slug problem %s to %s and writes no business row", async (problem, code) => {
    vi.mocked(businessSlugProblem).mockResolvedValueOnce(problem);
    const owner = await makeUser();
    await expectCode(
      createBusiness(db, { ownerUserId: owner.id, name: "Studio", slug: "studio", templateId: "hair-salon" }),
      code
    );
    expect(await prismock.flowkoBusiness.count()).toBe(0);
    expect(await prismock.flowkoBusinessMember.count()).toBe(0);
  });

  it("refuses a slug with the wrong shape as name_invalid (real name-space check)", async () => {
    const owner = await makeUser();
    await expectCode(
      createBusiness(db, {
        ownerUserId: owner.id,
        name: "Studio",
        slug: "Studio Ana",
        templateId: "hair-salon",
      }),
      "name_invalid"
    );
  });

  it("refuses an owner who is already a member of a business (user_in_business)", async () => {
    const owner = await makeUser();
    await createBusiness(db, {
      ownerUserId: owner.id,
      name: "Salon",
      slug: "salon-one",
      templateId: "hair-salon",
    });
    await expectCode(
      createBusiness(db, {
        ownerUserId: owner.id,
        name: "Salon 2",
        slug: "salon-two",
        templateId: "hair-salon",
      }),
      "user_in_business"
    );
    expect(await prismock.flowkoBusiness.count()).toBe(1);
  });

  it.each([
    ["an instance ADMIN", { role: UserPermissionRole.ADMIN }],
    ["a locked user", { locked: true }],
    ["a desk-only placeholder", { email: "desk-1@flowko.invalid", username: null }],
  ])("refuses %s as owner (bad_member) and writes no business row", async (_label, data) => {
    const owner = await makeUser(data);
    await expectCode(
      createBusiness(db, {
        ownerUserId: owner.id,
        name: "Salon",
        slug: "salon-ana",
        templateId: "hair-salon",
      }),
      "bad_member"
    );
    expect(await prismock.flowkoBusiness.count()).toBe(0);
  });

  it("refuses a missing owner (bad_member)", async () => {
    await expectCode(
      createBusiness(db, {
        ownerUserId: 999_999,
        name: "Salon",
        slug: "salon-ana",
        templateId: "hair-salon",
      }),
      "bad_member"
    );
    expect(await prismock.flowkoBusiness.count()).toBe(0);
  });

  it("looks the owner up with the locked opt-out (excludeLockedUsers would hide a locked owner)", async () => {
    const spy = vi.spyOn(prismock.user, "findFirst");
    const owner = await makeUser();
    await createBusiness(db, {
      ownerUserId: owner.id,
      name: "Salon",
      slug: "salon-ana",
      templateId: "hair-salon",
    });
    const ownerLookup = spy.mock.calls.find(
      (c) => (c[0] as { where?: { id?: unknown } } | undefined)?.where?.id === owner.id
    );
    expect(ownerLookup).toBeDefined();
    expect((ownerLookup?.[0] as { where: { OR: unknown } }).where.OR).toEqual([
      { locked: false },
      { locked: true },
    ]);
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a bad phone", { phone: "call me" }],
    ["an over-long address", { address: "a".repeat(201) }],
    [
      "bad opening hours",
      { templateId: null, openingHours: { ...template.openingHours, sun: [{ from: "01:00", to: "05:00" }] } },
    ],
  ])("refuses %s (bad_profile)", async (_label, patch) => {
    const owner = await makeUser();
    await expectCode(
      createBusiness(db, {
        ownerUserId: owner.id,
        name: "Salon",
        slug: "salon-ana",
        templateId: "hair-salon",
        ...patch,
      } as never),
      "bad_profile"
    );
    expect(await prismock.flowkoBusiness.count()).toBe(0);
  });

  it("joins the caller's transaction: every write lands on the passed stub", async () => {
    const owner = await makeUser();
    const transactionSpy = vi.spyOn(prismock, "$transaction");
    const writes: string[] = [];
    const WRITE_METHODS = new Set([
      "create",
      "createMany",
      "update",
      "updateMany",
      "upsert",
      "delete",
      "deleteMany",
    ]);
    const models = [
      "user",
      "flowkoBusiness",
      "flowkoBusinessMember",
      "flowkoService",
      "flowkoServiceWorker",
    ] as const;
    const stub: Record<string, unknown> = {};
    for (const model of models) {
      const delegate = prismock[model] as unknown as Record<string, (...args: unknown[]) => unknown>;
      stub[model] = new Proxy(delegate, {
        get(target, prop) {
          const value = target[prop as string];
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (WRITE_METHODS.has(String(prop))) writes.push(`${model}.${String(prop)}`);
            return value.apply(target, args);
          };
        },
      });
    }
    expect("$transaction" in stub).toBe(false);

    const result = await createBusiness(stub as unknown as FlowkoDb, {
      ownerUserId: owner.id,
      name: "Salon",
      slug: "salon-ana",
      templateId: "hair-salon",
    });

    expect(transactionSpy).not.toHaveBeenCalled();
    expect(result.serviceIds).toHaveLength(6);
    const rows =
      (await prismock.flowkoBusiness.count()) +
      (await prismock.flowkoBusinessMember.count()) +
      (await prismock.flowkoService.count()) +
      (await prismock.flowkoServiceWorker.count());
    expect(rows).toBe(1 + 1 + 6 + 6);
    expect(writes.every((w) => models.some((m) => w.startsWith(`${m}.`)))).toBe(true);
    expect(writes).toContain("flowkoBusiness.create");
    expect(writes).toContain("flowkoBusinessMember.create");
    expect(writes).toContain("flowkoService.create");
  });

  it("opens its own transaction on a client", async () => {
    const transactionSpy = vi.spyOn(prismock, "$transaction");
    await makeBusiness();
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createDeskOnlyWorker", () => {
  it("creates a password-less, username-less user on a desk address and a WORKER member", async () => {
    const { businessId } = await makeBusiness();

    const { memberId, userId } = await createDeskOnlyWorker(db, businessId, "  Maja  ");

    const user = await prismock.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();
    expect(isFlowkoDeskEmail(user?.email ?? "")).toBe(true);
    expect(user).toMatchObject({
      username: null,
      name: "Maja",
      timeZone: "Europe/Ljubljana",
      locale: "sl",
      timeFormat: 24,
      weekStart: "Monday",
      emailVerified: null,
      completedOnboarding: true,
      locked: false,
      role: UserPermissionRole.USER,
    });
    expect(await prismock.userPassword.count()).toBe(0);

    const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: memberId } });
    expect(member).toMatchObject({
      businessId,
      userId,
      role: FlowkoBusinessRole.WORKER,
      status: FlowkoMemberStatus.ACTIVE,
      displayName: "Maja",
      position: 1,
    });
  });

  it("gives each desk-only worker its own address", async () => {
    const { businessId } = await makeBusiness();
    const a = await createDeskOnlyWorker(db, businessId, "Maja");
    const b = await createDeskOnlyWorker(db, businessId, "Eva");
    const users = await prismock.user.findMany({ where: { id: { in: [a.userId, b.userId] } } });
    expect(new Set(users.map((u) => u.email)).size).toBe(2);
  });

  it.each(["", "   ", "a".repeat(81)])("refuses the display name %j (bad_member)", async (name) => {
    const { businessId } = await makeBusiness();
    const usersBefore = await prismock.user.count();
    await expectCode(createDeskOnlyWorker(db, businessId, name), "bad_member");
    expect(await prismock.user.count()).toBe(usersBefore);
  });

  it("refuses a missing business (forbidden) and creates no user", async () => {
    await expectCode(createDeskOnlyWorker(db, 999_999, "Maja"), "forbidden");
    expect(await prismock.user.count()).toBe(0);
  });
});

describe("addStaffWithoutLogin", () => {
  it("creates a STAFF member with no user", async () => {
    const { businessId } = await makeBusiness();
    const { memberId } = await addStaffWithoutLogin(db, businessId, "Recepcija");
    const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: memberId } });
    expect(member).toMatchObject({
      businessId,
      userId: null,
      role: FlowkoBusinessRole.STAFF,
      displayName: "Recepcija",
    });
  });

  it("refuses an empty display name (bad_member)", async () => {
    const { businessId } = await makeBusiness();
    await expectCode(addStaffWithoutLogin(db, businessId, " "), "bad_member");
  });
});

describe("addLoginMember", () => {
  it("adds a login user as WORKER, named after the user", async () => {
    const { businessId } = await makeBusiness();
    const worker = await makeUser({ name: "Eva Kos" });
    const { memberId } = await addLoginMember(db, businessId, worker.id, FlowkoBusinessRole.WORKER);
    const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: memberId } });
    expect(member).toMatchObject({
      businessId,
      userId: worker.id,
      role: FlowkoBusinessRole.WORKER,
      displayName: "Eva Kos",
    });
  });

  it("adds a login user as STAFF (receptionist)", async () => {
    const { businessId } = await makeBusiness();
    const staff = await makeUser();
    const { memberId } = await addLoginMember(db, businessId, staff.id, FlowkoBusinessRole.STAFF);
    const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: memberId } });
    expect(member?.role).toBe(FlowkoBusinessRole.STAFF);
  });

  it.each([
    ["a locked user", { locked: true }],
    ["a desk-only address", { email: "desk-2@flowko.invalid", username: null }],
    ["an instance ADMIN", { role: UserPermissionRole.ADMIN }],
  ])("refuses %s (bad_member)", async (_label, data) => {
    const { businessId } = await makeBusiness();
    const user = await makeUser(data);
    await expectCode(addLoginMember(db, businessId, user.id, FlowkoBusinessRole.WORKER), "bad_member");
    expect(await prismock.flowkoBusinessMember.count()).toBe(1);
  });

  it("refuses a missing user (bad_member) and the OWNER role (bad_member)", async () => {
    const { businessId } = await makeBusiness();
    await expectCode(addLoginMember(db, businessId, 999_999, FlowkoBusinessRole.WORKER), "bad_member");
    const user = await makeUser();
    await expectCode(
      addLoginMember(db, businessId, user.id, FlowkoBusinessRole.OWNER as never),
      "bad_member"
    );
  });

  it("refuses a user who is already a member somewhere (user_in_business)", async () => {
    const one = await makeBusiness("salon-one");
    const two = await makeBusiness("salon-two");
    const worker = await makeUser();
    await addLoginMember(db, one.businessId, worker.id, FlowkoBusinessRole.WORKER);
    await expectCode(
      addLoginMember(db, two.businessId, worker.id, FlowkoBusinessRole.WORKER),
      "user_in_business"
    );
  });

  it("refuses a missing business (forbidden)", async () => {
    const worker = await makeUser();
    await expectCode(addLoginMember(db, 999_999, worker.id, FlowkoBusinessRole.WORKER), "forbidden");
  });
});

describe("setServiceWorkers", () => {
  async function workersOf(serviceId: number): Promise<number[]> {
    const links = await prismock.flowkoServiceWorker.findMany({ where: { serviceId } });
    return links.map((l) => l.memberId).sort((a, b) => a - b);
  }

  it("replaces the set of members who perform a service", async () => {
    const { businessId, ownerMemberId, serviceIds } = await makeBusiness();
    const maja = await createDeskOnlyWorker(db, businessId, "Maja");
    const eva = await createDeskOnlyWorker(db, businessId, "Eva");

    await setServiceWorkers(db, serviceIds[0], [maja.memberId, eva.memberId, maja.memberId]);
    expect(await workersOf(serviceIds[0])).toEqual([maja.memberId, eva.memberId].sort((a, b) => a - b));
    // The other services keep the owner.
    expect(await workersOf(serviceIds[1])).toEqual([ownerMemberId]);

    await setServiceWorkers(db, serviceIds[0], []);
    expect(await workersOf(serviceIds[0])).toEqual([]);
  });

  it("refuses a member of another business, a STAFF member, a LOCKED member or a missing one (bad_member)", async () => {
    const mine = await makeBusiness("salon-one");
    const other = await makeBusiness("salon-two");
    const staff = await addStaffWithoutLogin(db, mine.businessId, "Recepcija");
    const locked = await createDeskOnlyWorker(db, mine.businessId, "Maja");
    await prismock.flowkoBusinessMember.update({
      where: { id: locked.memberId },
      data: { status: FlowkoMemberStatus.LOCKED },
    });
    const serviceId = mine.serviceIds[0];

    for (const memberId of [other.ownerMemberId, staff.memberId, locked.memberId, 999_999]) {
      await expectCode(setServiceWorkers(db, serviceId, [mine.ownerMemberId, memberId]), "bad_member");
      expect(await workersOf(serviceId)).toEqual([mine.ownerMemberId]);
    }
  });

  it("refuses a missing service (forbidden)", async () => {
    const { ownerMemberId } = await makeBusiness();
    await expectCode(setServiceWorkers(db, 999_999, [ownerMemberId]), "forbidden");
  });
});

describe("Teams stay untouched", () => {
  it("a full set-up writes no Team, Membership, Host, Profile or EventType row", async () => {
    const { businessId, serviceIds } = await makeBusiness();
    const worker = await makeUser();
    await addLoginMember(db, businessId, worker.id, FlowkoBusinessRole.WORKER);
    const desk = await createDeskOnlyWorker(db, businessId, "Maja");
    await addStaffWithoutLogin(db, businessId, "Recepcija");
    await setServiceWorkers(db, serviceIds[2], [desk.memberId]);

    expect(await prismock.team.count()).toBe(0);
    expect(await prismock.membership.count()).toBe(0);
    expect(await prismock.host.count()).toBe(0);
    expect(await prismock.profile.count()).toBe(0);
    expect(await prismock.eventType.count()).toBe(0);
  });
});
