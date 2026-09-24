import prismock from "@calcom/testing/lib/__mocks__/prisma";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import type { IUsersRepository } from "@calcom/features/users/users.repository.interface";
import { SchedulingType, WebhookTriggerEvents } from "@calcom/prisma/enums";

import { WebhookRepository } from "./WebhookRepository";

// A tenant could point their own event type's parentId at another tenant's event type. The parent's webhooks
// were then listed (with their secrets) and fired for bookings on the child, so the parent is followed only when
// it is a managed team event type
describe("WebhookRepository and a child event type's parent", () => {
  const ATTACKER = 1;
  const VICTIM = 2;
  const VICTIM_EVENT_TYPE = 10;
  const ATTACKER_EVENT_TYPE = 20;

  const userRepository = {
    findUserTeams: vi.fn().mockResolvedValue({ teams: [] }),
  } as unknown as IUsersRepository;

  const repository = () =>
    new WebhookRepository(prismock, new EventTypeRepository(prismock), userRepository);

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
    await prismock.webhook.create({
      data: {
        id: "victim-webhook",
        subscriberUrl: "https://victim.example/hook",
        secret: "victim-secret",
        active: true,
        eventTypeId: VICTIM_EVENT_TYPE,
        eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
      },
    });
    await prismock.webhook.create({
      data: {
        id: "attacker-webhook",
        subscriberUrl: "https://attacker.example/hook",
        secret: "attacker-secret",
        active: true,
        eventTypeId: ATTACKER_EVENT_TYPE,
        eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
      },
    });
  }

  describe("listWebhooks", () => {
    it("lists none of the webhooks of another tenant's personal event type", async () => {
      await seed({ teamId: null, schedulingType: null });

      const webhooks = await repository().listWebhooks({ userId: ATTACKER, eventTypeId: ATTACKER_EVENT_TYPE });

      expect(webhooks.map((webhook) => webhook.id)).toEqual(["attacker-webhook"]);
    });

    it("still lists the webhooks of a managed team parent", async () => {
      await seed({ teamId: 5, schedulingType: SchedulingType.MANAGED });

      const webhooks = await repository().listWebhooks({ userId: ATTACKER, eventTypeId: ATTACKER_EVENT_TYPE });

      expect(webhooks.map((webhook) => webhook.id).sort()).toEqual(["attacker-webhook", "victim-webhook"]);
    });
  });

  describe("getSubscribers", () => {
    let queryValues: unknown[];

    beforeEach(() => {
      queryValues = [];
      // prismock has no $queryRaw; record the values bound into the UNION query instead
      vi.spyOn(prismock, "$queryRaw").mockImplementation((async (
        _strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        queryValues = values;
        return [];
      }) as never);
    });

    it("does not query the webhooks of another tenant's personal event type", async () => {
      await seed({ teamId: null, schedulingType: null });

      await repository().getSubscribers({
        userId: ATTACKER,
        eventTypeId: ATTACKER_EVENT_TYPE,
        triggerEvent: WebhookTriggerEvents.BOOKING_CREATED,
      });

      expect(queryValues).toContain(ATTACKER_EVENT_TYPE);
      expect(queryValues).not.toContain(VICTIM_EVENT_TYPE);
    });

    it("still queries the webhooks of a managed team parent", async () => {
      await seed({ teamId: 5, schedulingType: SchedulingType.MANAGED });

      await repository().getSubscribers({
        userId: ATTACKER,
        eventTypeId: ATTACKER_EVENT_TYPE,
        triggerEvent: WebhookTriggerEvents.BOOKING_CREATED,
      });

      expect(queryValues).toContain(VICTIM_EVENT_TYPE);
    });
  });
});
