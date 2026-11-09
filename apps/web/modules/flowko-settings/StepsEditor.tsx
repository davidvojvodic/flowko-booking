// Flowko U29a: a service's steps (S9). StepsBar draws them as a small horizontal bar sized by minutes: busy steps
// solid, processing steps hatched with a dashed edge (the desk's BookingBlock look; that drawing is a vertical
// time-positioned block, so the bar is its own small component). StepsEditor edits the steps: per row the kind
// („Z delom“ / „Učinkovanje“) and minutes, move up/down, remove (not the only step); „Dodaj korak“ up to 8 steps;
// the live total and bar; the S9 rules always shown. Controlled and rule-free: the caller validates
// (serviceInputSchema) and passes each row's and the list's translated error. Minutes are kept as typed text, so a
// cleared field stays empty instead of jumping to 0.
import { SERVICE_LIMITS } from "@calcom/lib/flowkoBusiness/schemas";
import type { ServiceStep, StepKind } from "@calcom/lib/flowkoSalon";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";

/** One editor row: `key` keeps React rows stable while steps move. */
export type StepDraft = { key: number; kind: StepKind; minutes: string };
type BarStep = { kind: StepKind; minutes: number };

const HATCH =
  "repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(100, 116, 139, 0.35) 4px, rgba(100, 116, 139, 0.35) 8px)";
const KINDS: readonly StepKind[] = ["busy", "processing"];
const KIND_KEYS: Record<StepKind, string> = {
  busy: "flowko_settings_service_step_busy",
  processing: "flowko_settings_service_step_processing",
};
const NEW_STEP: Omit<StepDraft, "key"> = { kind: "busy", minutes: "15" };
const SELECT_CLASS = "border-default bg-default text-emphasis h-9 rounded-md border px-2 text-sm";

export function toDrafts(steps: readonly ServiceStep[]): StepDraft[] {
  return steps.map((step, key) => ({ key, kind: step.kind, minutes: String(step.minutes) }));
}

/** The drafts as the schema reads them: a blank or non-numeric minutes field is 0 (which the rules refuse). */
export function draftSteps(drafts: readonly StepDraft[]): BarStep[] {
  return drafts.map((d) => {
    const minutes = d.minutes.trim() === "" ? 0 : Number(d.minutes);
    return { kind: d.kind, minutes: Number.isFinite(minutes) ? minutes : 0 };
  });
}

export function StepsBar(props: { steps: readonly BarStep[]; className?: string }) {
  const { t } = useLocale();
  const label = props.steps
    .map((s) => `${t(KIND_KEYS[s.kind])} ${t("flowko_settings_service_minutes", { minutes: s.minutes })}`)
    .join(", ");
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      data-testid="flowko-steps-bar"
      className={`flex h-3 w-40 max-w-full gap-px overflow-hidden rounded-sm ${props.className ?? ""}`}>
      {props.steps.map((s, i) =>
        s.kind === "processing" ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: steps have no identity beyond their position
            key={i}
            data-kind="processing"
            data-pattern="hatched"
            className="border-brand-default border-y-2 border-dashed"
            style={{ flexGrow: Math.max(s.minutes, 0), flexBasis: 0, backgroundImage: HATCH }}
          />
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: steps have no identity beyond their position
            key={i}
            data-kind="busy"
            className="bg-brand-default"
            style={{ flexGrow: Math.max(s.minutes, 0), flexBasis: 0 }}
          />
        )
      )}
    </div>
  );
}

export function StepsEditor(props: {
  value: StepDraft[];
  onChange: (next: StepDraft[]) => void;
  /** Translated error per step index, shown under its row. */
  stepErrors?: Partial<Record<number, string>>;
  /** Translated error of the whole list (rules across steps, count, total). */
  listError?: string;
}) {
  const { t } = useLocale();
  const { value, onChange } = props;
  const steps = draftSteps(value);
  const total = steps.reduce((sum, s) => sum + s.minutes, 0);

  const setStep = (index: number, patch: Partial<StepDraft>) =>
    onChange(value.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const move = (index: number, delta: -1 | 1) => {
    const next = value.slice();
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    onChange(next);
  };
  const add = () => {
    const key = value.reduce((max, d) => Math.max(max, d.key + 1), 0);
    onChange([...value, { key, ...NEW_STEP }]);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-subtle text-sm">{t("flowko_settings_service_steps_hint")}</p>
      <ol className="flex flex-col gap-2">
        {value.map((draft, index) => {
          const step = index + 1;
          const error = props.stepErrors?.[index];
          return (
            <li key={draft.key} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-subtle w-5 text-sm tabular-nums">{step}.</span>
                <select
                  aria-label={t("flowko_settings_service_step_kind", { step })}
                  className={SELECT_CLASS}
                  value={draft.kind}
                  onChange={(e) => setStep(index, { kind: e.target.value as StepKind })}>
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(KIND_KEYS[kind])}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={t("flowko_settings_service_step_minutes", { step })}
                  aria-invalid={error ? true : undefined}
                  className={`${SELECT_CLASS} w-20 tabular-nums`}
                  min={SERVICE_LIMITS.stepMinutesMin}
                  max={SERVICE_LIMITS.stepMinutesMax}
                  step={SERVICE_LIMITS.stepMinutesMultiple}
                  value={draft.minutes}
                  onChange={(e) => setStep(index, { minutes: e.target.value })}
                />
                <span className="text-subtle text-sm">min</span>
                <div className="ml-auto flex items-center">
                  <Button
                    type="button"
                    variant="icon"
                    color="minimal"
                    StartIcon="arrow-up"
                    aria-label={t("flowko_settings_service_step_up", { step })}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                  <Button
                    type="button"
                    variant="icon"
                    color="minimal"
                    StartIcon="arrow-down"
                    aria-label={t("flowko_settings_service_step_down", { step })}
                    disabled={index === value.length - 1}
                    onClick={() => move(index, 1)}
                  />
                  <Button
                    type="button"
                    variant="icon"
                    color="minimal"
                    StartIcon="trash-2"
                    aria-label={t("flowko_settings_service_step_remove", { step })}
                    disabled={value.length <= 1}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  />
                </div>
              </div>
              {error && (
                <p
                  role="alert"
                  data-testid={`flowko-service-step-${index}-error`}
                  className="text-error text-sm">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div>
        <Button
          type="button"
          color="minimal"
          size="sm"
          StartIcon="plus"
          disabled={value.length >= SERVICE_LIMITS.stepsMax}
          onClick={add}>
          {t("flowko_settings_service_step_add")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="flowko-service-total" className="text-emphasis text-sm font-medium tabular-nums">
          {t("flowko_settings_service_total", { minutes: total })}
        </span>
        <StepsBar steps={steps} />
      </div>
      {props.listError && (
        <p role="alert" data-testid="flowko-service-steps-error" className="text-error text-sm">
          {props.listError}
        </p>
      )}
      <p className="text-subtle text-sm">{t("flowko_settings_service_steps_rules")}</p>
    </div>
  );
}
