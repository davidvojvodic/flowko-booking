import { getFirstDelegationConferencingCredentialAppLocation } from "@calcom/app-store/delegationCredential";
import { withReporting } from "@calcom/lib/sentryWrapper";
import type { Prisma } from "@calcom/prisma/client";
import { userMetadata as userMetadataSchema } from "@calcom/prisma/zod-utils";
import type { CredentialForCalendarService } from "@calcom/types/Credential";

const sortUsersByDynamicList = <TUser extends { username: string | null }>(
  users: TUser[],
  dynamicUserList: string[]
) => {
  return users.sort((a, b) => {
    const aIndex = (a.username && dynamicUserList.indexOf(a.username)) || 0;
    const bIndex = (b.username && dynamicUserList.indexOf(b.username)) || 0;
    return aIndex - bIndex;
  });
};

export const _getLocationValuesForDb = <
  TUser extends {
    username: string | null;
    metadata: Prisma.JsonValue;
    credentials: CredentialForCalendarService[];
  },
>({
  dynamicUserList,
  isDynamicEventType,
  users,
  location: locationBodyString,
}: {
  dynamicUserList: string[];
  /** The booking is for a dynamic group link's default event type (eventType.isDynamic), not a stored one */
  isDynamicEventType: boolean;
  users: TUser[];
  location: string;
}) => {
  // Flowko (U8e): dynamicUserList comes from the request body's `user` ("a+b"), which any booker can send
  // with a stored event type's id. Counting that as a dynamic group booking replaced the event type's own
  // location (an in-person address) with the organizer's default conferencing link, and a dry run handed the
  // link back. Only a real dynamic group booking, which has no stored event type, takes the first member's
  // default; it is off in this fork (IS_DYNAMIC_GROUP_BOOKING_ENABLED).
  const isDynamicGroupBookingCase = isDynamicEventType && dynamicUserList.length > 1;
  let firstDynamicGroupMemberDefaultLocationUrl;
  // TODO: It's definition should be moved to getLocationValueForDb
  if (isDynamicGroupBookingCase) {
    users = sortUsersByDynamicList(users, dynamicUserList);
    const firstDynamicGroupMember = users[0];
    const firstDynamicGroupMemberMetadata = userMetadataSchema.parse(firstDynamicGroupMember.metadata);
    const firstDynamicGroupMemberDelegationCredentialConferencingAppLocation =
      getFirstDelegationConferencingCredentialAppLocation({
        credentials: firstDynamicGroupMember.credentials,
      });

    const defaultConferencingApp = firstDynamicGroupMemberMetadata?.defaultConferencingApp;

    const hasMemberSetConferencingPreference =
      !!defaultConferencingApp?.appSlug || !!defaultConferencingApp?.appLink;

    firstDynamicGroupMemberDefaultLocationUrl =
      (hasMemberSetConferencingPreference
        ? defaultConferencingApp?.appLink
        : firstDynamicGroupMemberDelegationCredentialConferencingAppLocation) ?? null;

    locationBodyString = firstDynamicGroupMemberDefaultLocationUrl || locationBodyString;
  }

  return {
    locationBodyString,
    organizerOrFirstDynamicGroupMemberDefaultLocationUrl: firstDynamicGroupMemberDefaultLocationUrl,
  };
};

export const getLocationValuesForDb = withReporting(_getLocationValuesForDb, "getLocationValuesForDb");
