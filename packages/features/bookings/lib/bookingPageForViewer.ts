/**
 * The booking page (/booking/[uid]) opens for anyone holding the booking's uid: the booker, their
 * guests, and whoever the uid reached through the booking events (the embedding page, analytics
 * apps). Its props are serialised into the page, so a field the UI hides is still readable. For a
 * viewer who isn't a host of the booking, these helpers drop what the page doesn't need to show:
 * host user ids, host emails (every one of them when the event type hides the organizer's email),
 * phone numbers other than the viewer's own, app credential ids and private location details.
 * Every viewer, hosts included, gets at most one seat reference: the one they opened the page with.
 */

type HostIdentity = { id: number; email: string };

/** A host as a viewer who isn't a host sees them: without their user id and email. */
export type HostForViewer<TUser> = Omit<TUser, "id" | "email"> & { id?: number; email?: string };

type EventTypeWithHosts = {
  userId?: number | null;
  users: HostIdentity[];
  hosts: { user: HostIdentity }[];
  owner: HostIdentity | null;
  metadata?: unknown;
  locations?: unknown;
};

export type EventTypeForViewer<T extends EventTypeWithHosts> = T extends unknown
  ? Omit<T, "users" | "hosts" | "owner" | "userId"> & {
      users: HostForViewer<T["users"][number]>[];
      hosts: (Omit<T["hosts"][number], "user"> & { user: HostForViewer<T["hosts"][number]["user"]> })[];
      owner: HostForViewer<NonNullable<T["owner"]>> | null;
      userId?: T["userId"];
    }
  : never;

type BookingInfoWithPeople = {
  user: HostIdentity | null;
  attendees: { email: string; phoneNumber: string | null }[];
  userPrimaryEmail: string | null;
  smsReminderNumber: string | null;
  cancelledBy: string | null;
  rescheduledBy: string | null;
  assignmentReason: unknown[];
  seatsReferences: { referenceUid: string }[];
  recurringEventId: string | null;
};

export type BookingInfoForViewer<T extends BookingInfoWithPeople> = Omit<T, "user" | "attendees"> & {
  user: (Omit<NonNullable<T["user"]>, "id" | "email"> & { id?: number; email: string | null }) | null;
  attendees: (Omit<T["attendees"][number], "email"> & { email: string | null; isHost: boolean })[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Every email under which a host of the booking can appear among its attendees. */
export function getHostEmails({
  eventType,
  organizerEmails,
}: {
  eventType: Pick<EventTypeWithHosts, "users" | "hosts" | "owner">;
  organizerEmails: (string | null | undefined)[];
}): Set<string> {
  const emails = [
    ...eventType.users.map((user) => user.email),
    ...eventType.hosts.map((host) => host.user.email),
    eventType.owner?.email,
    ...organizerEmails,
  ];
  return new Set(emails.flatMap((email) => (email ? [normaliseEmail(email)] : [])));
}

export function toOrganizerForViewer<TUser extends HostIdentity>(user: TUser, hideOrganizerEmail: boolean) {
  const { id: _id, email, ...userWithoutIdentity } = user;
  return { ...userWithoutIdentity, email: hideOrganizerEmail ? null : email };
}

export function toHostForViewer<TUser extends HostIdentity>(
  user: TUser,
  canViewHostDetails: boolean
): HostForViewer<TUser> {
  if (canViewHostDetails) return user;
  const { id: _id, email: _email, ...userWithoutIdentity } = user;
  return userWithoutIdentity;
}

// The event type's app settings keep the id of the credential each app uses
export function withoutAppCredentialIds<TMetadata>(metadata: TMetadata): TMetadata {
  if (!isRecord(metadata) || !isRecord(metadata.apps)) return metadata;
  const apps = Object.fromEntries(
    Object.entries(metadata.apps).map(([slug, app]) => {
      if (!isRecord(app)) return [slug, app];
      const { credentialId: _credentialId, ...appWithoutCredentialId } = app;
      return [slug, appWithoutCredentialId];
    })
  );
  return { ...metadata, apps } as TMetadata;
}

// Same fields as privacyFilteredLocations in app-store/locations: an address, link or host phone number
// is only public when the organizer chose to display it publicly
function withoutPrivateLocationDetails<TLocations>(locations: TLocations): TLocations {
  if (!Array.isArray(locations)) return locations;
  return locations.map((location) => {
    if (!isRecord(location) || location.displayLocationPublicly) return location;
    const { address: _address, link: _link, hostPhoneNumber: _hostPhoneNumber, ...publicLocation } = location;
    return publicLocation;
  }) as TLocations;
}

export function toEventTypeForViewer<T extends EventTypeWithHosts>(
  eventType: T,
  canViewHostDetails: boolean
): EventTypeForViewer<T> {
  if (canViewHostDetails) return eventType as unknown as EventTypeForViewer<T>;
  const { userId: _userId, ...eventTypeWithoutUserId } = eventType;
  return {
    ...eventTypeWithoutUserId,
    users: eventType.users.map((user) => toHostForViewer(user, false)),
    hosts: eventType.hosts.map((host) => ({ ...host, user: toHostForViewer(host.user, false) })),
    owner: eventType.owner ? toHostForViewer(eventType.owner, false) : null,
    metadata: withoutAppCredentialIds(eventType.metadata),
    locations: withoutPrivateLocationDetails(eventType.locations),
  } as unknown as EventTypeForViewer<T>;
}

export function toBookingInfoForViewer<T extends BookingInfoWithPeople>(
  bookingInfo: T,
  {
    canViewHostDetails,
    hideOrganizerEmail,
    hostEmails,
    viewerEmails,
    viewerSeatReferenceUid,
  }: {
    canViewHostDetails: boolean;
    hideOrganizerEmail: boolean;
    hostEmails: Set<string>;
    /** The signed-in user's email and the email the booker was redirected with */
    viewerEmails: Set<string>;
    /** The seat reference the page was opened with: `?seatReferenceUid=` or /booking/[seatReferenceUid] */
    viewerSeatReferenceUid?: string;
  }
): BookingInfoForViewer<T> {
  // A seat's referenceUid cancels or reschedules that seat without a login (handleCancelBooking,
  // handleSeats), so the page must not hand out the other seats' references. The viewer proves a seat is
  // theirs by holding its reference, which the booker's success redirect and their emails carry. The page
  // only checks that this reference is still among the booking's seats.
  const seatsReferences = bookingInfo.seatsReferences.filter(
    (reference) => !!viewerSeatReferenceUid && reference.referenceUid === viewerSeatReferenceUid
  );

  // Team members of collective and fixed round-robin events are stored as attendees
  const attendees = bookingInfo.attendees.map((attendee) => {
    const isHost = hostEmails.has(normaliseEmail(attendee.email));
    if (canViewHostDetails) return { ...attendee, isHost };
    return {
      ...attendee,
      isHost,
      email: isHost && hideOrganizerEmail ? null : attendee.email,
      phoneNumber: viewerEmails.has(normaliseEmail(attendee.email)) ? attendee.phoneNumber : null,
    };
  });

  // TypeScript can't relate spreads of a generic type to the mapped result type, hence the casts
  if (canViewHostDetails) {
    return { ...bookingInfo, attendees, seatsReferences } as unknown as BookingInfoForViewer<T>;
  }

  return {
    ...bookingInfo,
    user: bookingInfo.user ? toOrganizerForViewer(bookingInfo.user, hideOrganizerEmail) : null,
    // The organizer's calendar email (the destination calendar's when the event type uses it)
    userPrimaryEmail: hideOrganizerEmail ? null : bookingInfo.userPrimaryEmail,
    // The page doesn't show who cancelled when the organizer's email is hidden, and never who rescheduled
    cancelledBy: hideOrganizerEmail ? null : bookingInfo.cancelledBy,
    rescheduledBy: hideOrganizerEmail ? null : bookingInfo.rescheduledBy,
    smsReminderNumber: null,
    // Not read by the page. A booking request can name any series' id, and cancelling that booking with
    // allRemainingBookings cancels the series' remaining occurrences
    recurringEventId: null,
    // Shown to hosts only; the reason text can name team members
    assignmentReason: [],
    attendees,
    seatsReferences,
  } as unknown as BookingInfoForViewer<T>;
}
