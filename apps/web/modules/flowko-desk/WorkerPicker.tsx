// Flowko U28: the worker picker of the week view (D2): one button per worker with a column, the chosen one
// pressed. Plain buttons rather than a select: one tap on a tablet.
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

export function WorkerPicker(props: {
  workers: Array<{ memberId: number; displayName: string }>;
  value: number | null;
  onChange: (memberId: number) => void;
}) {
  const { t } = useLocale();
  return (
    <div
      role="radiogroup"
      aria-label={t("flowko_desk_worker")}
      className="flex flex-wrap items-center gap-1.5">
      {props.workers.map((w) => {
        const selected = w.memberId === props.value;
        return (
          <button
            key={w.memberId}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => props.onChange(w.memberId)}
            className={classNames(
              "h-9 rounded-md border px-3 text-sm font-medium",
              selected
                ? "bg-inverted text-inverted border-inverted"
                : "bg-default text-default border-default hover:bg-subtle"
            )}>
            {w.displayName}
          </button>
        );
      })}
    </div>
  );
}
