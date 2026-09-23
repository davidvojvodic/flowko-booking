import { post } from "@calcom/lib/fetch-wrapper";

import type { BookingCreateBody } from "../types";
import type { PublicBookingResponse } from "./publicBookingResponse";

export const createBooking = async (data: BookingCreateBody) => {
  const response = await post<
    BookingCreateBody,
    // fetch response can't have a Date type, it must be a string
    Omit<PublicBookingResponse, "startTime" | "endTime"> & {
      startTime: string;
      endTime: string;
    }
  >("/api/book/event", data);
  return response;
};
