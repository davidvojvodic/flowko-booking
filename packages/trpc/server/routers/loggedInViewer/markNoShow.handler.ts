import type { Session } from "next-auth";

import { assertNotBusinessBookingTrpc } from "@calcom/features/flowkoBusiness/calGuards";
import { handleMarkAttendeesAndHostNoShow } from "@calcom/features/handleMarkNoShow";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import type { TNoShowInputSchema } from "./markNoShow.schema";

type NoShowOptions = {
  input: TNoShowInputSchema;
  ctx: {
    user: NonNullable<TrpcSessionUser>;
    session: Session;
  };
};

export const markNoShow = async ({ ctx, input }: NoShowOptions) => {
  const { bookingUid, attendees, noShowHost } = input;

  // Flowko U28 (D4): a business booking's no-show is the desk's own (bookings.noShow, logged, one customer);
  // refused before any write. The anonymous markHostAsNoShow stays (the customer's report about the host).
  await assertNotBusinessBookingTrpc({ uid: bookingUid });

  return handleMarkAttendeesAndHostNoShow({
    bookingUid,
    attendees,
    noShowHost,
    userId: ctx.user.id,
    locale: ctx.user.locale,
  });
};
