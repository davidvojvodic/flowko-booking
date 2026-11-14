// Flowko U29a: who does a service (S10). Every column member (OWNER/WORKER) in roster order: an ACTIVE one is a
// checkbox (desk-only included); a LOCKED one is shown disabled with its stored state („Dan (zaklenjeno)“, the
// desk's form) and is never added or removed here (the server keeps its assignment). Controlled: `checked` holds the
// ticked ACTIVE ids, onToggle(memberId, on) reports one click (Flowko U29c, P3). With nobody ticked it says the calendar cannot book the
// service (allowed; the list shows „Nihče“), also when only a LOCKED member still has it.
// Flowko U29e: E10.1 (R17) — the LOCKED member's „Dan (zaklenjeno)“ passes RAW, so a name with „&“ shows once.
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { CheckboxField } from "@calcom/ui/components/form";
import { RAW } from "@calcom/web/lib/flowko/i18nRaw";

export type WorkerRow = {
  memberId: number;
  displayName: string;
  status: "ACTIVE" | "LOCKED";
  /** Does the service now (for a new service: false). */
  assigned: boolean;
};

export const isLocked = (row: { status: string }) => row.status === "LOCKED";

export function ServiceWorkers(props: {
  rows: readonly WorkerRow[];
  checked: readonly number[];
  /** Flowko U29c (P3): one call per click, for that member only; the sheet keeps the user's toggles. */
  onToggle: (memberId: number, on: boolean) => void;
}) {
  const { t } = useLocale();
  const { rows, checked } = props;
  const active = rows.filter((r) => !isLocked(r));
  // The desk books only ACTIVE members, so a LOCKED assignment alone leaves the service unbookable.
  const nobodyBookable = !active.some((r) => checked.includes(r.memberId));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-emphasis mb-2 text-sm font-medium">
        {t("flowko_settings_service_workers")}
      </legend>
      {rows.length === 0 && (
        <p className="text-subtle text-sm">{t("flowko_settings_service_workers_empty")}</p>
      )}
      {rows.map((row) => {
        const locked = isLocked(row);
        return (
          <CheckboxField
            key={row.memberId}
            id={`flowko-service-worker-${row.memberId}`}
            description={
              locked ? t("flowko_desk_locked_column", { name: row.displayName, ...RAW }) : row.displayName
            }
            disabled={locked}
            checked={locked ? row.assigned : checked.includes(row.memberId)}
            onChange={(e) => {
              if (!locked) props.onToggle(row.memberId, e.target.checked);
            }}
          />
        );
      })}
      {rows.length > 0 && nobodyBookable && (
        <p className="text-subtle text-sm">{t("flowko_settings_service_workers_none_hint")}</p>
      )}
      {rows.some(isLocked) && (
        <p className="text-subtle text-sm">{t("flowko_settings_service_workers_locked_hint")}</p>
      )}
    </fieldset>
  );
}
