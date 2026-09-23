import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";

const log = logger.getSubLogger({ prefix: ["[checkActiveBookingsLimitForBooker]"] });

export const checkActiveBookingsLimitForBooker = async ({
  eventTypeId,
  maxActiveBookingsPerBooker,
  bookerEmail,
  offerToRescheduleLastBooking,
  loggedInUserId,
  isBookerEmailVerified = false,
}: {
  eventTypeId: number;
  maxActiveBookingsPerBooker: number | null;
  bookerEmail: string;
  offerToRescheduleLastBooking: boolean;
  loggedInUserId?: number;
  /** The caller already proved they own bookerEmail with a verification code */
  isBookerEmailVerified?: boolean;
}) => {
  if (!maxActiveBookingsPerBooker) {
    return;
  }

  // Flowko: the reschedule offer returns the booker's latest booking uid and seat reference, and either one
  // cancels or reschedules that booking without a login. Anyone can type an email into the booking form, so
  // only a caller who proved they own it gets the offer. Everyone else gets the count only.
  if (
    offerToRescheduleLastBooking &&
    (isBookerEmailVerified || (await isBookerEmailOfLoggedInUser({ bookerEmail, loggedInUserId })))
  ) {
    await checkActiveBookingsLimitAndOfferReschedule({
      eventTypeId,
      maxActiveBookingsPerBooker,
      bookerEmail,
    });
  } else {
    await checkActiveBookingsLimit({ eventTypeId, maxActiveBookingsPerBooker, bookerEmail });
  }
};

/** Whether bookerEmail is a verified primary or secondary email of the signed-in user */
const isBookerEmailOfLoggedInUser = async ({
  bookerEmail,
  loggedInUserId,
}: {
  bookerEmail: string;
  loggedInUserId?: number;
}) => {
  if (!loggedInUserId || loggedInUserId < 1) {
    return false;
  }

  const user = await prisma.user.findUnique({
    where: { id: loggedInUserId },
    select: {
      email: true,
      emailVerified: true,
      secondaryEmails: {
        select: {
          email: true,
          emailVerified: true,
        },
      },
    },
  });
  if (!user) {
    return false;
  }

  const normalisedBookerEmail = bookerEmail.trim().toLowerCase();
  return [user, ...user.secondaryEmails].some(
    ({ email, emailVerified }) => !!emailVerified && email.trim().toLowerCase() === normalisedBookerEmail
  );
};

/** If we don't need the last record then we should just use COUNT */
const checkActiveBookingsLimit = async ({
  eventTypeId,
  maxActiveBookingsPerBooker,
  bookerEmail,
}: {
  eventTypeId: number;
  maxActiveBookingsPerBooker: number;
  bookerEmail: string;
}) => {
  const bookingsCount = await prisma.booking.count({
    where: {
      eventTypeId,
      startTime: {
        gte: new Date(),
      },
      status: {
        in: [BookingStatus.ACCEPTED],
      },
      attendees: {
        some: {
          email: bookerEmail,
        },
      },
    },
  });

  if (bookingsCount >= maxActiveBookingsPerBooker) {
    log.warn(`Maximum booking limit reached for a booker for event type ${eventTypeId}`);
    throw new ErrorWithCode(ErrorCode.BookerLimitExceeded, ErrorCode.BookerLimitExceeded, {
      count: maxActiveBookingsPerBooker,
    });
  }
};

const checkActiveBookingsLimitAndOfferReschedule = async ({
  eventTypeId,
  maxActiveBookingsPerBooker,
  bookerEmail,
}: {
  eventTypeId: number;
  maxActiveBookingsPerBooker: number;
  bookerEmail: string;
}) => {
  const bookingsCount = await prisma.booking.findMany({
    where: {
      eventTypeId,
      startTime: {
        gte: new Date(),
      },
      status: {
        in: [BookingStatus.ACCEPTED],
      },
      attendees: {
        some: {
          email: bookerEmail,
        },
      },
    },
    orderBy: {
      startTime: "desc",
    },
    take: maxActiveBookingsPerBooker,
    select: {
      uid: true,
      startTime: true,
      attendees: {
        select: {
          name: true,
          email: true,
          bookingSeat: {
            select: {
              referenceUid: true,
            },
          },
        },
        where: {
          email: bookerEmail,
        },
      },
    },
  });

  const lastBooking = bookingsCount[bookingsCount.length - 1];
  // Get the seatUid for the booker's seat in this booking (if it's a seated event)
  const seatUid = lastBooking?.attendees[0]?.bookingSeat?.referenceUid;

  if (bookingsCount.length >= maxActiveBookingsPerBooker) {
    log.warn(`Maximum booking limit reached for a booker for event type ${eventTypeId}`);
    throw new ErrorWithCode(
      ErrorCode.BookerLimitExceededReschedule,
      ErrorCode.BookerLimitExceededReschedule,
      {
        rescheduleUid: lastBooking.uid,
        startTime: lastBooking.startTime,
        attendees: lastBooking.attendees,
        seatUid,
      }
    );
  }
};
