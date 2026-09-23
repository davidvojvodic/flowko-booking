import { post } from "@calcom/lib/fetch-wrapper";

import type { RecurringBookingCreateBody } from "../types";
import type { PublicBookingResponse } from "./publicBookingResponse";

export const createRecurringBooking = async (data: RecurringBookingCreateBody[]) => {
  const response = await post<
    RecurringBookingCreateBody[],
    // fetch response can't have a Date type, it must be a string
    (Omit<PublicBookingResponse, "startTime" | "endTime"> & {
      startTime: string;
      endTime: string;
    })[]
  >("/api/book/recurring-event", data);
  return response;
};
