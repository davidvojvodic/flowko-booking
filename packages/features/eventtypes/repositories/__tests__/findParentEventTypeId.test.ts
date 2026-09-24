import prismock from "@calcom/testing/lib/__mocks__/prisma";

import { describe, expect, it } from "vitest";

import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { SchedulingType } from "@calcom/prisma/enums";

// A parentId naming another tenant's personal event type made the child pull in that tenant's webhooks, so the
// parent is followed only when it is a managed team event type (there are none on this instance)
describe("EventTypeRepository.findParentEventTypeId", () => {
  const repository = () => new EventTypeRepository(prismock);

  async function seed(parent: { teamId?: number | null; schedulingType?: SchedulingType | null }) {
    await prismock.eventType.create({
      data: { id: 10, title: "Victim", slug: "victim", length: 30, userId: 2, ...parent },
    });
    await prismock.eventType.create({
      data: { id: 20, title: "Attacker", slug: "attacker", length: 30, userId: 1, parentId: 10 },
    });
  }

  it("does not follow a parentId to another tenant's personal event type", async () => {
    await seed({ teamId: null, schedulingType: null });

    expect(await repository().findParentEventTypeId(20)).toBeNull();
  });

  it("does not follow a parentId to a team event type that is not managed", async () => {
    await seed({ teamId: 5, schedulingType: SchedulingType.ROUND_ROBIN });

    expect(await repository().findParentEventTypeId(20)).toBeNull();
  });

  it("does not follow a parentId to a managed event type without a team", async () => {
    await seed({ teamId: null, schedulingType: SchedulingType.MANAGED });

    expect(await repository().findParentEventTypeId(20)).toBeNull();
  });

  it("follows a parentId to a managed team event type", async () => {
    await seed({ teamId: 5, schedulingType: SchedulingType.MANAGED });

    expect(await repository().findParentEventTypeId(20)).toBe(10);
  });

  it("returns null for an event type without a parent", async () => {
    await seed({ teamId: 5, schedulingType: SchedulingType.MANAGED });

    expect(await repository().findParentEventTypeId(10)).toBeNull();
  });
});
