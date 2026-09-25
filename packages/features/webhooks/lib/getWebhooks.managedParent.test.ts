import prismock from "@calcom/testing/lib/__mocks__/prisma";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SchedulingType, WebhookTriggerEvents } from "@calcom/prisma/enums";

import getWebhooks from "./getWebhooks";

// A tenant could point their own event type's parentId at another tenant's event type, and the parent's
// webhooks then fired, signed with the parent owner's secret, for every booking on the child. The parent is
// followed only when it is a managed team event type
describe("getWebhooks and a child event type's parent", () => {
  const ATTACKER = 1;
  const VICTIM = 2;
  const VICTIM_EVENT_TYPE = 10;
  const ATTACKER_EVENT_TYPE = 20;

  let webhookWhere: { OR: Record<string, unknown>[] } | undefined;

  beforeEach(() => {
    webhookWhere = undefined;
    // prismock can't evaluate this OR plus AND filter, so record the filter and answer no webhooks
    vi.spyOn(prismock.webhook, "findMany").mockImplementation((async (args: { where: never }) => {
      webhookWhere = structuredClone(args.where);
      return [];
    }) as never);
  });

  async function seed(parent: { teamId: number | null; schedulingType: SchedulingType | null }) {
    await prismock.eventType.create({
      data: {
        id: VICTIM_EVENT_TYPE,
        title: "Victim",
        slug: "victim",
        length: 30,
        userId: VICTIM,
        ...parent,
      },
    });
    await prismock.eventType.create({
      data: {
        id: ATTACKER_EVENT_TYPE,
        title: "Attacker",
        slug: "attacker",
        length: 30,
        userId: ATTACKER,
        parentId: VICTIM_EVENT_TYPE,
      },
    });
  }

  const eventTypeIdsQueried = () =>
    (webhookWhere?.OR ?? []).flatMap((clause) => ("eventTypeId" in clause ? [clause.eventTypeId] : []));

  it("does not look up the webhooks of another tenant's personal event type", async () => {
    await seed({ teamId: null, schedulingType: null });

    await getWebhooks(
      { userId: ATTACKER, eventTypeId: ATTACKER_EVENT_TYPE, triggerEvent: WebhookTriggerEvents.BOOKING_CREATED },
      prismock
    );

    expect(eventTypeIdsQueried()).toContain(ATTACKER_EVENT_TYPE);
    expect(eventTypeIdsQueried()).not.toContain(VICTIM_EVENT_TYPE);
  });

  it("does not look up the webhooks of a team event type that is not managed", async () => {
    await seed({ teamId: 5, schedulingType: SchedulingType.COLLECTIVE });

    await getWebhooks(
      { userId: ATTACKER, eventTypeId: ATTACKER_EVENT_TYPE, triggerEvent: WebhookTriggerEvents.BOOKING_CREATED },
      prismock
    );

    expect(eventTypeIdsQueried()).not.toContain(VICTIM_EVENT_TYPE);
  });

  it("still looks up the webhooks of a managed team parent", async () => {
    await seed({ teamId: 5, schedulingType: SchedulingType.MANAGED });

    await getWebhooks(
      { userId: ATTACKER, eventTypeId: ATTACKER_EVENT_TYPE, triggerEvent: WebhookTriggerEvents.BOOKING_CREATED },
      prismock
    );

    expect(eventTypeIdsQueried()).toContain(VICTIM_EVENT_TYPE);
  });
});
