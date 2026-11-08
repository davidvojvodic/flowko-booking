import { getPublicEvent } from "@calcom/features/eventtypes/lib/getPublicEvent";
import { mirrorOfEventType } from "@calcom/features/flowkoBusiness/mirror";
import prisma from "@calcom/prisma";

export type GetPublicEventInput = {
  username: string;
  eventSlug: string;
  isTeamEvent?: boolean;
  org: string | null;
  fromRedirectOfNonOrgLink: boolean;
};

export class EventRepository {
  static async getPublicEvent(input: GetPublicEventInput, userId?: number) {
    const event = await getPublicEvent(
      input.username,
      input.eventSlug,
      input.isTeamEvent,
      input.org,
      prisma,
      input.fromRedirectOfNonOrgLink,
      userId
    );
    // Flowko U27: a worker mirror is no public event; every public page treats it as not found (or redirects first).
    if (event && (await mirrorOfEventType(prisma, event.id))) return null;
    return event;
  }
}
