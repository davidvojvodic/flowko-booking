// Flowko U29c: the future bookings of a LOCKED worker (W8, C11, C12), as the server lists them (at most 50, then a
// count of the rest): one link per booking to that day on the desk (same tab) with the local date, time, service
// names and the customer's name. Nothing else about the booking or the customer is shown (no e-mail, no phone).
// The date is the business-local date string treated as UTC midnight for the weekday (as Urnik's headers do); the
// year is added when it differs from the current one. A booking is moved by cancelling it and entering it for
// another worker (the hint under the list).
"use client";

import type { WorkerListBooking } from "@calcom/lib/flowkoBusiness/workers";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import Link from "next/link";

function dayText(date: string, language: string, withYear: boolean): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function WorkerBookings(props: {
  bookings: readonly WorkerListBooking[];
  /** Bookings beyond the listed ones. */
  more: number;
  currentYear: number;
}) {
  const { t, i18n } = useLocale();
  const language = i18n?.language ?? "sl";

  if (props.bookings.length === 0 && props.more === 0) {
    return (
      <p data-testid="flowko-worker-no-bookings" className="text-subtle mt-3 w-full text-sm">
        {t("flowko_workers_no_bookings")}
      </p>
    );
  }

  return (
    <div className="mt-3 w-full">
      <ul className="divide-subtle border-subtle divide-y rounded-md border text-sm">
        {props.bookings.map((booking) => {
          const year = Number(booking.date.slice(0, 4));
          const line = [
            dayText(booking.date, language, year !== props.currentYear),
            `${booking.from}–${booking.to}`,
            booking.services.join(", "),
            booking.customerName,
          ]
            .filter((part) => part !== "")
            .join(" · ");
          return (
            <li key={booking.bookingId}>
              <Link
                href={`/koledar?view=day&date=${booking.date}`}
                className="text-default hover:bg-subtle focus-visible:ring-brand-default block px-3 py-2 tabular-nums focus-visible:outline-none focus-visible:ring-2">
                {line}
              </Link>
            </li>
          );
        })}
      </ul>
      {props.more > 0 && (
        <p data-testid="flowko-worker-more-bookings" className="text-subtle mt-2 text-sm">
          {t("flowko_workers_more_bookings", { count: props.more })}
        </p>
      )}
      <p className="text-subtle mt-2 text-sm">{t("flowko_workers_handover_hint")}</p>
    </div>
  );
}
