// Flowko U29a: the business profile page (S2, S3, S5, S16, S17), owner only (the page guards; the API refuses
// anyone else). Reads viewer.flowko.business.settings (no suspense, no server initial data) and edits name, phone
// (required), address, the business e-mail (Reply-To of customer mails), opening hours, slot grid, the holiday
// switch, the reminder choice and the shared-device switch; slug (as the call page link) and time zone are shown
// read-only. Validation = businessSettingsSchema, with an empty address or e-mail sent as null. The save sends the
// loaded updatedAt as expectedUpdatedAt: needs_confirm opens the dialog with the two counts and „Vseeno shrani“
// resends with confirm: true; settings_changed refetches, shows the current settings and says so (no silent
// overwrite). The form is keyed by updatedAt, so it always edits one stored version. A save invalidates
// business.me (the desk chip follows sharedDevice), business.settings and the desk's day/week/free starts (S17).
"use client";

import type { BusinessSettingsView } from "@calcom/features/flowkoBusiness/settings";
import {
  type BusinessSettings,
  businessSettingsSchema,
  type OpeningHours,
  SLOT_GRIDS,
  WEEKDAYS,
  type Weekday,
} from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Alert } from "@calcom/ui/components/alert";
import { Button } from "@calcom/ui/components/button";
import { SettingsToggle, TextField } from "@calcom/ui/components/form";
import { SkeletonText } from "@calcom/ui/components/skeleton";
import { showToast } from "@calcom/ui/components/toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { DayRangesEditor } from "./DayRangesEditor";
import { type OutsideCounts, OutsideOpeningDialog } from "./OutsideOpeningDialog";
import { ReminderChoice } from "./ReminderChoice";

/** Server codes of business.updateSettings with their own text (anything else: something_went_wrong). */
export const SETTINGS_ERROR_CODES = [
  "forbidden",
  "bad_profile",
  "settings_changed",
  "TOO_MANY_REQUESTS",
] as const;
type SettingsErrorCode = (typeof SETTINGS_ERROR_CODES)[number];

/** businessSettingsSchema's issue codes (Task 1) with a field text; any other message shows the "invalid" text. */
export const SETTINGS_FIELD_CODES = [
  "name_length",
  "control_character",
  "phone_required",
  "phone_format",
  "address_length",
  "email_length",
  "email_format",
  "email_placeholder",
  "no_open_day",
  "time_format",
  "start_at_24",
  "before_03_00",
  "end_not_after_start",
  "unsorted_or_overlapping",
  "slot_grid",
  "reminder_offsets",
  "invalid",
] as const;

const isIn = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/** The save's error code: the Flowko code in `message` (flowkoTrpcError), else the tRPC code (rate limiter). */
function settingsErrorCode(error: unknown): SettingsErrorCode | "unknown" {
  if (typeof error !== "object" || error === null) return "unknown";
  const { message, data } = error as { message?: unknown; data?: { code?: unknown } | null };
  if (isIn(SETTINGS_ERROR_CODES, message)) return message;
  if (isIn(SETTINGS_ERROR_CODES, data?.code)) return data.code;
  return "unknown";
}

const fieldKey = (code: string | undefined): string | undefined =>
  code === undefined
    ? undefined
    : `flowko_settings_field_${isIn(SETTINGS_FIELD_CODES, code) ? code : "invalid"}`;

/** The first issue code anywhere under an error node (a day's rows, a row's from/to); DOM refs are skipped. */
function firstCode(node: unknown): string | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const { message } = node as { message?: unknown };
  if (typeof message === "string") return message;
  for (const [key, child] of Object.entries(node)) {
    if (key === "ref" || key === "types") continue;
    const code = firstCode(child);
    if (code !== undefined) return code;
  }
  return undefined;
}

type FormValues = {
  name: string;
  phone: string;
  address: string;
  email: string;
  openingHours: OpeningHours;
  slotGridMinutes: number;
  holidaysClosed: boolean;
  reminderOffsets: number[];
  sharedDevice: boolean;
};

/** A blank address or e-mail is "none" (null): businessSettingsSchema refuses "" (address_length / email_format). */
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const formSchema = businessSettingsSchema.extend({
  address: z.preprocess(blankToNull, businessSettingsSchema.shape.address),
  email: z.preprocess(blankToNull, businessSettingsSchema.shape.email),
});

function toFormValues(settings: BusinessSettingsView): FormValues {
  return {
    name: settings.name,
    phone: settings.phone ?? "",
    address: settings.address ?? "",
    email: settings.email ?? "",
    openingHours: settings.openingHours,
    slotGridMinutes: settings.slotGridMinutes,
    holidaysClosed: settings.holidaysClosed,
    reminderOffsets: Array.from(settings.reminderOffsets),
    sharedDevice: settings.sharedDevice,
  };
}

// Flowko U29b: the error carries an id, so its control can point at it with aria-describedby (D1 a).
const fieldError = (text: string | undefined, errorId: string, testId?: string) =>
  text ? (
    <p id={errorId} role="alert" data-testid={testId} className="text-error mt-1 text-sm">
      {text}
    </p>
  ) : null;

function ProfileForm(props: {
  settings: BusinessSettingsView;
  /** The settings are being refetched: a save now would carry a stale updatedAt. */
  refreshing: boolean;
  onStale: () => Promise<void>;
  onSaved: () => void;
}) {
  const { settings } = props;
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const mutation = trpc.viewer.flowko.business.updateSettings.useMutation();
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ outside: OutsideCounts; values: BusinessSettings } | null>(null);
  // The call page link with this site's origin (read after mount, so server and client render the same text).
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(settings),
  });
  const { errors, isDirty } = form.formState;
  // Flowko U29b: ids for the field errors and the reminders heading. Never passed as `id` to TextField
  // (it would break the label's htmlFor).
  const idBase = useId();
  const errorId = (field: string) => `${idBase}-${field}-error`;

  // S17: everything that shows the business settings: the shell and the desk chip (me), this page, the desk.
  const invalidateAfterSave = () =>
    Promise.all([
      utils.viewer.flowko.business.me.invalidate(),
      utils.viewer.flowko.business.settings.invalidate(),
      utils.viewer.flowko.bookings.day.invalidate(),
      utils.viewer.flowko.bookings.week.invalidate(),
      utils.viewer.flowko.bookings.freeStarts.invalidate(),
    ]).catch(() => undefined);

  async function send(values: BusinessSettings, confirmed: boolean) {
    setSaving(true);
    try {
      let result: Awaited<ReturnType<typeof mutation.mutateAsync>>;
      try {
        result = await mutation.mutateAsync({
          ...values,
          expectedUpdatedAt: settings.updatedAt,
          confirm: confirmed,
        });
      } catch (error) {
        const code = settingsErrorCode(error);
        if (code === "settings_changed") {
          await props.onStale();
          return;
        }
        showToast(t(code === "unknown" ? "something_went_wrong" : `flowko_settings_error_${code}`), "error");
        return;
      }
      if (result.status === "needs_confirm") {
        setConfirm({ outside: result.outside, values });
        return;
      }
      showToast(t("flowko_settings_saved"), "success");
      props.onSaved();
      await invalidateAfterSave();
    } finally {
      setSaving(false);
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    // The resolver already applied the schema; parsing again gives the typed output (idempotent).
    await send(formSchema.parse(values), false);
  });

  const text = (code: string | undefined) => {
    const key = fieldKey(code);
    return key ? t(key) : undefined;
  };
  const openingErrors = errors.openingHours as unknown as
    | ({ message?: string } & Partial<Record<Weekday, unknown>>)
    | undefined;
  const dayErrors: Partial<Record<Weekday, string>> = {};
  for (const day of WEEKDAYS) {
    const message = text(firstCode(openingErrors?.[day]));
    if (message) dayErrors[day] = message;
  }

  const nameText = text(errors.name?.message);
  const phoneText = text(errors.phone?.message);
  const addressText = text(errors.address?.message);
  const emailText = text(errors.email?.message);
  const slotGridText = text(errors.slotGridMinutes?.message);
  // Flowko U29b: aria-invalid + aria-describedby while a field shows an error (D1 a).
  const aria = (field: string, errorText: string | undefined) => ({
    "aria-invalid": errorText ? (true as const) : undefined,
    "aria-describedby": errorText ? errorId(field) : undefined,
  });

  return (
    <form noValidate onSubmit={onSubmit}>
      <div className="border-subtle flex flex-col gap-6 border-x px-4 py-8 sm:px-6">
        <div>
          <TextField
            label={t("flowko_settings_name")}
            hint={t("flowko_settings_name_hint")}
            maxLength={200}
            {...aria("name", nameText)}
            {...form.register("name")}
          />
          {fieldError(nameText, errorId("name"))}
        </div>
        <div>
          <TextField
            type="tel"
            label={t("flowko_settings_phone")}
            hint={t("flowko_settings_phone_hint")}
            maxLength={200}
            {...aria("phone", phoneText)}
            {...form.register("phone")}
          />
          {fieldError(phoneText, errorId("phone"))}
        </div>
        <div>
          <TextField
            label={t("flowko_settings_address")}
            maxLength={300}
            {...aria("address", addressText)}
            {...form.register("address")}
          />
          {fieldError(addressText, errorId("address"))}
        </div>
        <div>
          <TextField
            type="email"
            label={t("flowko_settings_email")}
            hint={t("flowko_settings_email_hint")}
            maxLength={300}
            {...aria("email", emailText)}
            {...form.register("email")}
          />
          {fieldError(emailText, errorId("email"))}
        </div>
        <div>
          {/* Flowko U29b: plain text, not a <label> bound to nothing (the value is a link). */}
          <p className="text-emphasis mb-2 text-sm font-medium">{t("flowko_settings_call_page")}</p>
          <a
            data-testid="flowko-settings-call-page"
            href={settings.callPagePath}
            target="_blank"
            rel="noreferrer"
            className="text-emphasis block break-all text-sm underline">
            {`${origin}${settings.callPagePath}`}
          </a>
          <p className="text-subtle mt-1 text-sm">{t("flowko_settings_call_page_hint")}</p>
        </div>
        <div>
          <p className="text-emphasis mb-2 text-sm font-medium">{t("timezone")}</p>
          <p data-testid="flowko-settings-time-zone" className="text-emphasis text-sm">
            {settings.timeZone}
          </p>
        </div>
      </div>

      <div className="border-subtle flex flex-col gap-4 border-x border-t px-4 py-8 sm:px-6">
        <div>
          <h3 className="text-emphasis text-base font-semibold">{t("flowko_settings_opening_hours")}</h3>
          <p className="text-subtle text-sm">{t("flowko_settings_opening_hours_hint")}</p>
        </div>
        <Controller
          name="openingHours"
          control={form.control}
          render={({ field }) => (
            <DayRangesEditor value={field.value} onChange={field.onChange} dayErrors={dayErrors} />
          )}
        />
        {fieldError(
          typeof openingErrors?.message === "string" ? text(openingErrors.message) : undefined,
          errorId("opening"),
          "flowko-settings-opening-error"
        )}
        <div>
          <label htmlFor="flowko-settings-slot-grid" className="text-emphasis mb-2 block text-sm font-medium">
            {t("flowko_settings_slot_grid")}
          </label>
          <select
            id="flowko-settings-slot-grid"
            className="border-default bg-default text-emphasis h-9 rounded-md border px-2 text-sm"
            {...aria("slotGrid", slotGridText)}
            {...form.register("slotGridMinutes", { valueAsNumber: true })}>
            {SLOT_GRIDS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t("flowko_settings_slot_grid_option", { minutes })}
              </option>
            ))}
          </select>
          <p className="text-subtle mt-1 text-sm">{t("flowko_settings_slot_grid_hint")}</p>
          {fieldError(slotGridText, errorId("slotGrid"))}
        </div>
        <Controller
          name="holidaysClosed"
          control={form.control}
          render={({ field }) => (
            <SettingsToggle
              data-testid="flowko-settings-holidays-closed"
              toggleSwitchAtTheEnd={true}
              title={t("flowko_settings_holidays_closed")}
              description={t("flowko_settings_holidays_closed_hint")}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </div>

      <div className="border-subtle flex flex-col gap-4 border-x border-t px-4 py-8 sm:px-6">
        <h3 id={`${idBase}-reminders-title`} className="text-emphasis text-base font-semibold">
          {t("flowko_settings_reminders")}
        </h3>
        <Controller
          name="reminderOffsets"
          control={form.control}
          render={({ field }) => (
            <ReminderChoice
              value={field.value}
              onChange={field.onChange}
              labelledBy={`${idBase}-reminders-title`}
            />
          )}
        />
        {fieldError(text(errors.reminderOffsets?.message), errorId("reminders"))}
        <Controller
          name="sharedDevice"
          control={form.control}
          render={({ field }) => (
            <SettingsToggle
              data-testid="flowko-settings-shared-device"
              toggleSwitchAtTheEnd={true}
              title={t("flowko_settings_shared_device")}
              description={t("flowko_settings_shared_device_hint")}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </div>

      <div className="border-subtle flex justify-end rounded-b-xl border px-4 py-4 sm:px-6">
        <Button
          type="submit"
          color="primary"
          loading={saving}
          disabled={!isDirty || saving || props.refreshing}>
          {t("save")}
        </Button>
      </div>

      {confirm && (
        <OutsideOpeningDialog
          open
          outside={confirm.outside}
          busy={saving}
          onConfirm={() => void send(confirm.values, true)}
          onClose={() => setConfirm(null)}
        />
      )}
    </form>
  );
}

export default function BusinessProfileView() {
  const { t } = useLocale();
  const query = trpc.viewer.flowko.business.settings.useQuery(undefined, { refetchOnWindowFocus: false });
  const [changedNotice, setChangedNotice] = useState(false);

  if (!query.data) {
    if (query.error) {
      return (
        <div className="border-subtle flex flex-col items-start gap-3 rounded-b-xl border border-t-0 px-4 py-8 sm:px-6">
          <p className="text-error text-sm">{t("flowko_settings_load_error")}</p>
          <Button color="secondary" onClick={() => void query.refetch()}>
            {t("try_again")}
          </Button>
        </div>
      );
    }
    return (
      <div
        data-testid="flowko-settings-profile-loading"
        className="border-subtle flex flex-col gap-6 rounded-b-xl border border-t-0 px-4 py-8 sm:px-6">
        <SkeletonText className="h-8 w-full" />
        <SkeletonText className="h-8 w-full" />
        <SkeletonText className="h-8 w-full" />
      </div>
    );
  }

  const settings = query.data;
  return (
    <div>
      {changedNotice && (
        <div data-testid="flowko-settings-changed" className="border-subtle border-x px-4 pt-6 sm:px-6">
          <Alert severity="warning" title={t("flowko_settings_changed_notice")} />
        </div>
      )}
      <ProfileForm
        key={new Date(settings.updatedAt).getTime()}
        settings={settings}
        refreshing={query.isFetching}
        onStale={async () => {
          // settings_changed: show the stored settings (the form remounts on the new updatedAt) and say why.
          await query.refetch();
          setChangedNotice(true);
        }}
        onSaved={() => setChangedNotice(false)}
      />
    </div>
  );
}
