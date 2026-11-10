// Flowko U29a: the reminder e-mail choice (S5): U22's four choices (REMINDER_CHOICES) as radios. The value is the
// offsets list the server stores ([] = no reminder); the page states that each reminder is one e-mail per booking
// and that customers without an e-mail address get none.
import { REMINDER_CHOICES, type ReminderChoiceId } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { RadioField, RadioGroup } from "@calcom/ui/components/radio";

/** The choice whose offsets are exactly these (same order), else null. */
export function reminderChoiceOf(offsets: readonly number[]): ReminderChoiceId | null {
  const choice = REMINDER_CHOICES.find(
    (c) => c.offsets.length === offsets.length && c.offsets.every((offset, i) => offset === offsets[i])
  );
  return choice ? choice.id : null;
}

export function ReminderChoice(props: {
  value: readonly number[];
  onChange: (offsets: number[]) => void;
  disabled?: boolean;
  /** Flowko U29b: the id of the visible heading that names the radio group (D1 a). */
  labelledBy: string;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        value={reminderChoiceOf(props.value) ?? ""}
        disabled={props.disabled}
        aria-labelledby={props.labelledBy}
        onValueChange={(id) => {
          const choice = REMINDER_CHOICES.find((c) => c.id === id);
          if (choice) props.onChange(Array.from(choice.offsets));
        }}
        className="flex flex-col gap-2">
        {REMINDER_CHOICES.map((choice) => (
          <RadioField
            key={choice.id}
            id={`flowko-settings-reminder-${choice.id}`}
            value={choice.id}
            disabled={props.disabled}
            label={t(`flowko_settings_reminder_${choice.id}`)}
          />
        ))}
      </RadioGroup>
      <p data-testid="flowko-settings-reminders-hint" className="text-subtle text-sm">
        {t("flowko_settings_reminders_hint")}
      </p>
    </div>
  );
}
