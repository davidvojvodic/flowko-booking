// Flowko U29a: the service sheet (S8–S12). New: empty name and category, one 30-minute working step, every ACTIVE
// column member ticked (the owner unticks; LOCKED shown disabled and unticked). Edit: the stored values; a LOCKED
// member is disabled with its current state and is never sent (the server keeps its assignment). The save validates
// with serviceInputSchema (the server's own rules): name and category errors after the first save attempt, step
// errors at once; nothing is sent while a rule fails. Then services.save gets {id?, name, category, steps,
// workerMemberIds} (only ACTIVE ticked members); service_name_taken shows at the name, bad_member refreshes the list
// (someone was locked meanwhile; the rows follow the fresh list), every other code is a toast. The S11 note
// (plural) says existing future bookings keep their steps. „Odstrani“ opens the S12 dialog with the plural count of
// future bookings; confirm removes. After a write the caller invalidates (S17) and the sheet closes.
// Flowko U29e: E8 — services.save requires priceCents; until the „Cena“ field (U29e Task 9) the sheet sends the
// stored price back unchanged (a new service: null), so an edit never clears a price by omission.
"use client";

import type { OwnerService, ServiceColumnMember } from "@calcom/features/flowkoBusiness/services";
import { serviceInputSchema } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Alert } from "@calcom/ui/components/alert";
import { Button } from "@calcom/ui/components/button";
import { ConfirmationContent, Dialog, DialogContent } from "@calcom/ui/components/dialog";
import { TextField } from "@calcom/ui/components/form";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@calcom/ui/components/sheet";
import { showToast } from "@calcom/ui/components/toast";
import { useId, useRef, useState } from "react";
import type { ZodIssue } from "zod";
import { isLocked, ServiceWorkers, type WorkerRow } from "./ServiceWorkers";
import { draftSteps, type StepDraft, StepsEditor, toDrafts } from "./StepsEditor";

export type ServiceSheetTarget = { kind: "new" } | { kind: "edit"; service: OwnerService };

/** Server codes of services.save/remove/reorder with their own text (anything else: something_went_wrong). */
export const SERVICE_ERROR_CODES = [
  "forbidden",
  "bad_service",
  "bad_member",
  "service_name_taken",
  "TOO_MANY_REQUESTS",
] as const;
export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

/** serviceInputSchema's issue codes (Task 1, U24) with a service text; control_character reuses the profile's. */
const SERVICE_FIELD_CODES = [
  "name_length",
  "category_length",
  "empty",
  "no_busy_step",
  "starts_with_processing",
  "ends_with_processing",
  "bad_minutes",
  "step_too_long",
  "too_many_steps",
  "total_too_long",
] as const;

const isIn = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/** A write's error code: the Flowko code in `message` (flowkoTrpcError), else the tRPC code (rate limiter). */
export function serviceErrorCode(error: unknown): ServiceErrorCode | "unknown" {
  if (typeof error !== "object" || error === null) return "unknown";
  const { message, data } = error as { message?: unknown; data?: { code?: unknown } | null };
  if (isIn(SERVICE_ERROR_CODES, message)) return message;
  if (isIn(SERVICE_ERROR_CODES, data?.code)) return data.code;
  return "unknown";
}

/** The i18n key of a write's error code. */
export function serviceErrorKey(code: ServiceErrorCode | "unknown"): string {
  if (code === "unknown") return "something_went_wrong";
  if (code === "forbidden" || code === "TOO_MANY_REQUESTS") return `flowko_settings_error_${code}`;
  return `flowko_settings_service_error_${code}`;
}

function fieldKey(code: string): string {
  if (code === "control_character") return "flowko_settings_field_control_character";
  return isIn(SERVICE_FIELD_CODES, code)
    ? `flowko_settings_service_field_${code}`
    : "flowko_settings_field_invalid";
}

type Problems = {
  name?: string;
  category?: string;
  /** A rule across the steps (count, total, first/last/busy). */
  steps?: string;
  /** Per step index ("bad_minutes:2", "step_too_long:2" → 2). */
  step: Record<number, string>;
};

/** The first issue code per field; a step's indexed code goes to that step. */
function problemsOf(issues: readonly ZodIssue[]): Problems {
  const problems: Problems = { step: {} };
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === "name") problems.name ??= issue.message;
    else if (field === "category") problems.category ??= issue.message;
    else if (field === "steps") {
      const indexed = /^([a-z_]+):(\d+)$/.exec(issue.message);
      if (indexed) {
        const index = Number(indexed[2]);
        problems.step[index] ??= indexed[1];
      } else {
        problems.steps ??= issue.message;
      }
    }
  }
  return problems;
}

/** The rows of "who does it": the service's workers, or (new) every column member, none assigned yet. */
function workerRows(target: ServiceSheetTarget, members: readonly ServiceColumnMember[]): WorkerRow[] {
  if (target.kind === "edit") return target.service.workers;
  return members.map((m) => ({
    memberId: m.memberId,
    displayName: m.displayName,
    status: m.status,
    assigned: false,
  }));
}

const NEW_STEPS: StepDraft[] = [{ key: 0, kind: "busy", minutes: "30" }];

// Flowko U29b: the error carries an id, so its input can point at it with aria-describedby (D1 a).
const fieldError = (text: string | undefined, errorId: string, testId?: string) =>
  text ? (
    <p id={errorId} role="alert" data-testid={testId} className="text-error mt-1 text-sm">
      {text}
    </p>
  ) : null;

export function ServiceSheet(props: {
  target: ServiceSheetTarget;
  /** The column members (for a new service's rows and default). */
  members: readonly ServiceColumnMember[];
  onClose: () => void;
  /** A write happened (or the list is stale): invalidate the S17 queries. */
  onChanged: () => Promise<unknown> | void;
}) {
  const { t } = useLocale();
  const { target } = props;
  const service = target.kind === "edit" ? target.service : null;
  const rows = workerRows(target, props.members);
  const save = trpc.viewer.flowko.services.save.useMutation();
  const remove = trpc.viewer.flowko.services.remove.useMutation();

  const [name, setName] = useState(service?.name ?? "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [steps, setSteps] = useState<StepDraft[]>(() => (service ? toDrafts(service.steps) : NEW_STEPS));
  // Flowko U29c (P3): only the owner's clicks are state. Ticked = the click, else the live row (edit: assigned;
  // new: every ACTIVE member), so a refetch that turns a LOCKED member ACTIVE shows it ticked instead of dropping
  // its assignment on the next save, and an untick survives the refresh.
  const [toggles, setToggles] = useState<Record<number, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [nameTaken, setNameTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Flowko U29b: ids of the name/category errors, and the remove dialog (to focus its „Prekliči“).
  const idBase = useId();
  const nameErrorId = `${idBase}-name-error`;
  const categoryErrorId = `${idBase}-category-error`;
  const removeDialogRef = useRef<HTMLDivElement>(null);

  // Only members ACTIVE in the current rows are sent (one locked meanwhile drops out once the list refreshes).
  const workerMemberIds = rows
    .filter((r) => !isLocked(r) && (toggles[r.memberId] ?? (service ? r.assigned : true)))
    .map((r) => r.memberId);
  const input = {
    ...(service ? { id: service.id } : {}),
    name,
    category,
    steps: draftSteps(steps),
    workerMemberIds,
    priceCents: service?.priceCents ?? null, // Flowko U29e: E8
  };
  const parsed = serviceInputSchema.safeParse(input);
  const problems = parsed.success ? { step: {} } : problemsOf(parsed.error.issues);
  const nameText = nameTaken
    ? t("flowko_settings_service_error_service_name_taken")
    : submitted && problems.name
      ? t(fieldKey(problems.name))
      : undefined;
  const categoryText = submitted && problems.category ? t(fieldKey(problems.category)) : undefined;
  const stepErrors: Record<number, string> = {};
  for (const [index, code] of Object.entries(problems.step)) stepErrors[Number(index)] = t(fieldKey(code));

  // Flowko U29b: "busy" stays on through the S17 refresh and the close (the sheet unmounts), so a second click
  // cannot send a second write; it is cleared only where the sheet stays open (D1 c).
  /** The edited service is gone for this owner (forbidden = unknown or foreign id, e.g. removed elsewhere). */
  async function onGone() {
    showToast(t("flowko_settings_service_error_gone"), "error");
    await props.onChanged();
    props.onClose();
  }

  async function onSave() {
    setSubmitted(true);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const { id, ...fields } = parsed.data;
      await save.mutateAsync({ ...(id !== undefined ? { id } : {}), ...fields });
    } catch (error) {
      const code = serviceErrorCode(error);
      if (code === "service_name_taken") {
        setNameTaken(true);
        setBusy(false);
        return;
      }
      // Flowko U29b: on an edit, forbidden means the service is gone (D1 d); a new service keeps the plain text.
      if (code === "forbidden" && service) {
        await onGone();
        return;
      }
      showToast(t(serviceErrorKey(code)), "error");
      try {
        if (code === "bad_member") await props.onChanged();
      } finally {
        setBusy(false);
      }
      return;
    }
    showToast(t("flowko_settings_service_saved"), "success");
    await props.onChanged();
    props.onClose();
  }

  async function onRemove() {
    if (!service) return;
    setBusy(true);
    try {
      await remove.mutateAsync({ serviceId: service.id });
    } catch (error) {
      const code = serviceErrorCode(error);
      if (code === "forbidden") {
        await onGone();
        return;
      }
      showToast(t(serviceErrorKey(code)), "error");
      setBusy(false);
      return;
    }
    showToast(t("flowko_settings_service_removed"), "success");
    await props.onChanged();
    props.onClose();
  }

  const futureBookings = service?.futureBookings ?? 0;

  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent aria-describedby={undefined}>
        <form
          noValidate
          className="flex h-full flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}>
          <SheetHeader>
            <SheetTitle>
              {t(service ? "flowko_settings_service_title_edit" : "flowko_settings_service_new")}
            </SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-6">
            {futureBookings > 0 && (
              <div data-testid="flowko-service-future-bookings">
                <Alert
                  severity="info"
                  title={t("flowko_settings_service_future_bookings", { count: futureBookings })}
                />
              </div>
            )}
            <div>
              <TextField
                name="flowko-service-name"
                label={t("flowko_settings_service_name")}
                maxLength={200}
                value={name}
                aria-invalid={nameText ? true : undefined}
                aria-describedby={nameText ? nameErrorId : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTaken(false);
                }}
              />
              {fieldError(nameText, nameErrorId, "flowko-service-name-error")}
            </div>
            <div>
              <TextField
                name="flowko-service-category"
                label={t("flowko_settings_service_category")}
                hint={t("flowko_settings_service_category_hint")}
                maxLength={200}
                value={category}
                aria-invalid={categoryText ? true : undefined}
                aria-describedby={categoryText ? categoryErrorId : undefined}
                onChange={(e) => setCategory(e.target.value)}
              />
              {fieldError(categoryText, categoryErrorId, "flowko-service-category-error")}
            </div>
            <div>
              <h3 className="text-emphasis mb-2 text-sm font-medium">{t("flowko_settings_service_steps")}</h3>
              <StepsEditor
                value={steps}
                onChange={setSteps}
                stepErrors={stepErrors}
                listError={problems.steps ? t(fieldKey(problems.steps)) : undefined}
              />
            </div>
            <ServiceWorkers
              rows={rows}
              checked={workerMemberIds}
              onToggle={(memberId, on) => setToggles((prev) => ({ ...prev, [memberId]: on }))}
            />
          </SheetBody>
          <SheetFooter className="flex flex-wrap items-center gap-2">
            {service && (
              <Button
                type="button"
                color="destructive"
                StartIcon="trash-2"
                className="mr-auto"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}>
                {t("flowko_settings_service_remove")}
              </Button>
            )}
            <Button type="button" color="secondary" disabled={busy} onClick={props.onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" color="primary" loading={busy} disabled={busy}>
              {t("save")}
            </Button>
          </SheetFooter>
        </form>
        {service && confirmRemove && (
          <Dialog open onOpenChange={(open) => !open && setConfirmRemove(false)}>
            {/* Flowko U29b: ConfirmationDialogContent composed locally, so the dialog opens on „Prekliči“ and
                not on the destructive „Odstrani“, which comes first in the DOM (D1 b). */}
            <DialogContent
              type="creation"
              ref={removeDialogRef}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                removeDialogRef.current
                  ?.querySelector<HTMLElement>('[data-testid="dialog-rejection"]')
                  ?.focus();
              }}>
              <ConfirmationContent
                variety="danger"
                title={t("flowko_settings_service_remove_title", { name: service.name })}
                confirmBtnText={t("flowko_settings_service_remove")}
                cancelBtnText={t("cancel")}
                isPending={busy}
                onConfirm={() => void onRemove()}>
                <p data-testid="flowko-service-remove-bookings" className="mt-2">
                  {futureBookings > 0
                    ? t("flowko_settings_service_remove_bookings", { count: futureBookings })
                    : t("flowko_settings_service_remove_no_bookings")}
                </p>
                <p className="mt-2">{t("flowko_settings_service_remove_final")}</p>
              </ConfirmationContent>
            </DialogContent>
          </Dialog>
        )}
      </SheetContent>
    </Sheet>
  );
}
