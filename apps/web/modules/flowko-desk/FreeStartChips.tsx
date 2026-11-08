// Flowko U28: „Prosti termini“ (R10): the chosen worker's free starts for the chosen services, from the existing
// route `bookings.freeStarts` (never computed in the browser), asked only once services are chosen. A chip sets
// the booking sheet's time ("HH:mm" in the business time zone).
import { formatHm } from "@calcom/lib/flowkoBusiness/desk";
import { localDateSchema } from "@calcom/lib/flowkoBusiness/roster";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import classNames from "@calcom/ui/classNames";

export function FreeStartChips(props: {
  date: string;
  serviceIds: number[];
  memberId: number | null;
  timeZone: string;
  /** The sheet's current time ("HH:mm"): its chip shows pressed. */
  value: string;
  onPick: (time: string) => void;
}) {
  const { t } = useLocale();
  // A half-typed date in the sheet would be refused by the route: ask only with a real date.
  const enabled =
    props.serviceIds.length > 0 && props.memberId !== null && localDateSchema.safeParse(props.date).success;
  const query = trpc.viewer.flowko.bookings.freeStarts.useQuery(
    { date: props.date, serviceIds: props.serviceIds },
    { enabled, staleTime: 15_000 }
  );
  const worker = enabled ? query.data?.workers.find((w) => w.memberId === props.memberId) : undefined;
  const times = worker?.starts.map((iso) => formatHm(new Date(iso).getTime(), props.timeZone)) ?? [];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-emphasis text-sm font-medium">{t("flowko_desk_free_starts")}</span>
      {!enabled && <p className="text-subtle text-sm">{t("flowko_desk_free_starts_hint")}</p>}
      {enabled && query.data && !worker?.starts.length && (
        <p className="text-subtle text-sm">{t("flowko_desk_free_starts_none")}</p>
      )}
      {enabled && !query.data && query.isFetching && <p className="text-subtle text-sm">{t("loading")}</p>}
      {worker?.googleUnavailable && (
        <p className="text-attention text-sm">{t("flowko_desk_google_unavailable")}</p>
      )}
      {times.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {times.map((time) => (
            <button
              key={time}
              type="button"
              data-testid="desk-free-start"
              aria-pressed={time === props.value}
              onClick={() => props.onPick(time)}
              className={classNames(
                "min-h-10 rounded-md border px-3 text-sm font-medium tabular-nums",
                time === props.value
                  ? "bg-brand-default text-brand border-brand-default"
                  : "border-default bg-default text-emphasis hover:bg-subtle"
              )}>
              {time}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
