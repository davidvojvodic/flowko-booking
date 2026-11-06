// Flowko U22: the per-service switch for the booker's reminder e-mail (metadata.flowkoReminders), read by
// /api/cron/attendeeReminder. Absent = off; turning it off keeps the chosen offsets.
import type { FormValues } from "@calcom/features/eventtypes/lib/types";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { FlowkoReminders } from "@calcom/prisma/zod-utils";
import classNames from "@calcom/ui/classNames";
import { SettingsToggle } from "@calcom/ui/components/form";
import { RadioField } from "@calcom/ui/components/radio";
import * as RadioGroup from "@radix-ui/react-radio-group";
import type { ReactElement } from "react";
import { useFormContext } from "react-hook-form";

type Offsets = NonNullable<FlowkoReminders>["offsets"];
type Choice = "24h" | "2h" | "both";

// Fresh arrays on every call so the form never shares one array between values.
const offsetsFor = (choice: Choice): Offsets => {
  if (choice === "2h") return [120];
  if (choice === "both") return [1440, 120];
  return [1440];
};

const choiceFor = (offsets: Offsets | undefined): Choice => {
  if (offsets?.includes(1440) && offsets.includes(120)) return "both";
  if (offsets?.length === 1 && offsets[0] === 120) return "2h";
  return "24h";
};

export default function FlowkoRemindersController(): ReactElement {
  const { t } = useLocale();
  const formMethods = useFormContext<FormValues>();
  const current = formMethods.watch("metadata.flowkoReminders");
  const enabled = current?.enabled === true;

  // Same lock stub as the sibling controllers (managed event types are not used in the fork).
  const shouldLockDisableProps = (
    _field: string
  ): { disabled: boolean; LockedIcon: false; isLocked: boolean } => ({
    disabled: false,
    LockedIcon: false as const,
    isLocked: false,
  });
  const flowkoRemindersLocked = shouldLockDisableProps("metadata");

  return (
    <div className="block items-start sm:flex">
      <div className="w-full">
        <SettingsToggle
          labelClassName="text-sm"
          toggleSwitchAtTheEnd={true}
          switchContainerClassName={classNames(
            "border-subtle rounded-lg border py-6 px-4 sm:px-6",
            enabled && "rounded-b-none"
          )}
          childrenClassName="lg:ml-0"
          title={t("flowko_reminders_title")}
          data-testid="flowko-reminders-toggle"
          disabled={flowkoRemindersLocked.disabled}
          LockedIcon={flowkoRemindersLocked.LockedIcon}
          description={t("flowko_reminders_description")}
          checked={enabled}
          onCheckedChange={(val: boolean): void => {
            formMethods.setValue(
              "metadata.flowkoReminders",
              { enabled: val, offsets: current?.offsets ?? offsetsFor("24h") },
              { shouldDirty: true }
            );
          }}>
          <div className="rounded-b-lg border border-subtle border-t-0 p-6">
            <RadioGroup.Root
              value={choiceFor(current?.offsets)}
              onValueChange={(val: string): void => {
                formMethods.setValue("metadata.flowkoReminders.offsets", offsetsFor(val as Choice), {
                  shouldDirty: true,
                });
              }}>
              <div className="flex flex-col flex-wrap justify-start gap-y-2">
                <RadioField
                  label={t("flowko_reminders_24h")}
                  disabled={flowkoRemindersLocked.disabled}
                  id="flowko-reminders-24h"
                  value="24h"
                />
                <RadioField
                  label={t("flowko_reminders_2h")}
                  disabled={flowkoRemindersLocked.disabled}
                  id="flowko-reminders-2h"
                  value="2h"
                />
                <RadioField
                  label={t("flowko_reminders_both")}
                  disabled={flowkoRemindersLocked.disabled}
                  id="flowko-reminders-both"
                  value="both"
                />
              </div>
            </RadioGroup.Root>
            <p className="mt-2 text-sm text-subtle">{t("flowko_reminders_hint")}</p>
          </div>
        </SettingsToggle>
      </div>
    </div>
  );
}
