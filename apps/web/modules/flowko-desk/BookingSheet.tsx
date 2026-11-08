// Flowko U28: the booking sheet (R10, R12, R13, R17). Create: worker and start come from the tap; the services are
// chips of what that worker does (tap order = step order, at most 5); „Prosti termini“ from the server; the
// customer from the lookup or typed as „Nova stranka“. Re-enter („Prestavi k drugemu delavcu“): the same sheet
// pre-filled from the old booking (services from `serviceIds` in order, or none with a note when a service was
// deleted; the customer), the worker selectable without the booking's own worker; on save the new booking is
// created FIRST and only then the old one cancelled with „Prestavljeno k: {{name}}“, so the customer's slot is
// never lost; a failed cancel says both bookings exist. `needs_confirm` opens the override dialog (after the
// refetch in useDeskWrites); `in_past` and `bad_customer` show at their fields.
// Flowko U28b (B2): the customer section shows the search first („Ime ali telefon“ + „Nova stranka“); a picked
// customer is a compact card with „Zamenjaj“ (back to the search); „Nova stranka“ reveals the name/phone/e-mail
// fields, pre-filled from the typed text; re-enter opens with the old customer as the card. Save stays disabled
// until a customer is chosen or the new-customer fields are valid. The create payload is unchanged.
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { DeskBooking, DeskColumn } from "@calcom/features/flowkoBusiness/desk";
import { formatHm } from "@calcom/lib/flowkoBusiness/desk";
import { localDateSchema, todayIn } from "@calcom/lib/flowkoBusiness/roster";
import type { FitProblem, Ms } from "@calcom/lib/flowkoSalon";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import classNames from "@calcom/ui/classNames";
import { Button } from "@calcom/ui/components/button";
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

import { ConfirmProblemsDialog, stepNamesOf } from "./ConfirmProblemsDialog";
import { CustomerCard, CustomerField } from "./CustomerField";
import type { CustomerPrefill } from "./CustomerField";
import { useDeskContext } from "./DeskContext";
import { FreeStartChips } from "./FreeStartChips";
import type { DeskCreateInput, DeskWriteCode } from "./useDeskWrites";
import { useDeskWrites } from "./useDeskWrites";

export type BookingSheetTarget =
  | { kind: "create"; memberId: number; start: Ms }
  | { kind: "reenter"; booking: DeskBooking };

/** R10: at most five services per visit (the route's limit). */
export const MAX_SERVICES = 5;
const FIELD_CODES: readonly DeskWriteCode[] = ["in_past", "bad_customer"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Messages are i18n keys. R17 caps: name 80, phone 32, e-mail 254 (the route refuses longer ones).
// Flowko U28b: the customer part on its own, so Save can wait for a valid customer (B2).
const customerSchema = z
  .object({
    name: z.string().trim().min(1, "flowko_desk_required_name").max(80, "flowko_desk_error_bad_customer"),
    phone: z.string().trim().max(32, "flowko_desk_error_bad_customer"),
    email: z.string().trim().max(254, "flowko_desk_error_bad_customer"),
  })
  .refine((c) => c.phone !== "" || c.email !== "", {
    message: "flowko_desk_required_contact",
    path: ["phone"],
  });

const schema = z.object({
  memberId: z
    .number()
    .nullable()
    // An explicit boolean: a type-predicate refine would narrow the form's type to number (null is its start).
    .refine((v): boolean => v !== null, { message: "flowko_desk_required_worker" }),
  serviceIds: z.array(z.number()).min(1, "flowko_desk_required_services").max(MAX_SERVICES),
  date: z
    .string()
    .refine((v) => localDateSchema.safeParse(v).success, { message: "flowko_desk_required_time" }),
  time: z.string().regex(TIME_RE, "flowko_desk_required_time"),
  customer: customerSchema,
});
type Values = z.infer<typeof schema>;

/** Flowko U28b (B2): search = nothing chosen yet; card = a picked (or the re-entered) customer; new = the fields. */
type CustomerMode = "search" | "card" | "new";

type Pending = { payload: DeskCreateInput; problems: FitProblem[]; googleUnavailable: boolean };

function defaults(target: BookingSheetTarget, timeZone: string): Values {
  const start = target.kind === "create" ? target.start : new Date(target.booking.start).getTime();
  const base = { date: todayIn(timeZone, new Date(start)), time: formatHm(start, timeZone) };
  if (target.kind === "create") {
    return {
      ...base,
      memberId: target.memberId,
      serviceIds: [],
      customer: { name: "", phone: "", email: "" },
    };
  }
  const { customer, serviceIds } = target.booking;
  return {
    ...base,
    memberId: null,
    serviceIds: serviceIds ?? [],
    customer: { name: customer.name, phone: customer.phone ?? "", email: customer.email ?? "" },
  };
}

/** Every column the shown view has (a week repeats the same worker), first occurrence wins. */
function columnsOf(days: Array<{ columns: DeskColumn[] }>): DeskColumn[] {
  const seen = new Map<number, DeskColumn>();
  for (const day of days) for (const c of day.columns) if (!seen.has(c.memberId)) seen.set(c.memberId, c);
  return Array.from(seen.values());
}

export function BookingSheet(props: { target: BookingSheetTarget; onClose: () => void }) {
  const { t } = useLocale();
  const ctx = useDeskContext();
  const writes = useDeskWrites(ctx);
  const { target, onClose } = props;
  const timeZone = ctx.view?.timeZone ?? "UTC";
  const services = trpc.viewer.flowko.business.services.useQuery(undefined, { staleTime: 60_000 }).data ?? [];
  const columns = useMemo(() => columnsOf(ctx.view?.days ?? []), [ctx.view]);
  const reenter = target.kind === "reenter" ? target.booking : null;

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(target, timeZone) });
  const { errors, isSubmitting } = form.formState;
  const memberId = form.watch("memberId");
  const selected = form.watch("serviceIds");
  const [pending, setPending] = useState<Pending | null>(null);
  // Flowko U28: the „Vseeno shrani“ resend runs outside handleSubmit; while it runs, Save and the dialog's confirm
  // are off, so a second tap cannot resend without the override.
  const [busy, setBusy] = useState(false);
  // Flowko U28b (B2): re-enter starts with the old booking's customer as the card; a new booking with the search.
  const [customerMode, setCustomerMode] = useState<CustomerMode>(reenter ? "card" : "search");
  const customer = form.watch("customer");
  const customerReady =
    customerMode === "card" || (customerMode === "new" && customerSchema.safeParse(customer).success);

  const workerName = (id: number) =>
    columns.find((c) => c.memberId === id)?.displayName ??
    ctx.actor.choices.find((m) => m.memberId === id)?.displayName ??
    "";
  const offered = services.filter(
    (s) => (memberId !== null && s.workerMemberIds.includes(memberId)) || selected.includes(s.id)
  );
  // Flowko U28: a week view holds one worker's column, so the others come from the member list (those with a column).
  const workerChoices = useMemo(() => {
    const byId = new Map<number, { memberId: number; displayName: string }>();
    for (const c of columns) if (!c.locked) byId.set(c.memberId, c);
    for (const m of ctx.actor.choices) if (m.hasColumn && !byId.has(m.memberId)) byId.set(m.memberId, m);
    return Array.from(byId.values()).filter((c) => c.memberId !== reenter?.memberId);
  }, [columns, ctx.actor.choices, reenter?.memberId]);

  const toggle = (id: number) => {
    const next = selected.includes(id)
      ? selected.filter((s) => s !== id)
      : selected.length < MAX_SERVICES
        ? [...selected, id]
        : selected;
    form.setValue("serviceIds", next, { shouldValidate: form.formState.isSubmitted });
  };

  const setCustomer = (c: { name: string; phone: string | null; email: string | null }) => {
    const opts = { shouldValidate: form.formState.isSubmitted };
    form.setValue("customer.name", c.name, opts);
    form.setValue("customer.phone", c.phone ?? "", opts);
    form.setValue("customer.email", c.email ?? "", opts);
  };
  const pickCustomer = (c: { name: string; phone: string | null; email: string | null }) => {
    setCustomer(c);
    setCustomerMode("card");
  };
  const newCustomer = (prefill: CustomerPrefill) => {
    setCustomer({ name: prefill.name, phone: prefill.phone, email: "" });
    setCustomerMode("new");
  };
  const changeCustomer = () => {
    setCustomer({ name: "", phone: "", email: "" });
    form.clearErrors("customer");
    setCustomerMode("search");
  };

  async function save(payload: DeskCreateInput) {
    const outcome = await writes.create(payload, {
      fieldCodes: FIELD_CODES,
      toasts: reenter ? "errors" : "all",
    });
    if (outcome.kind === "confirm") {
      setPending({ payload, problems: outcome.problems, googleUnavailable: outcome.googleUnavailable });
      return;
    }
    if (outcome.kind === "error") {
      if (outcome.code === "in_past") form.setError("time", { message: outcome.message });
      if (outcome.code === "bad_customer") form.setError("customer.name", { message: outcome.message });
      return;
    }
    if (outcome.kind !== "done") return;
    if (reenter) {
      // R12: the new booking exists; only now the old one goes.
      const name = workerName(payload.workerMemberId);
      const cancelled = await writes.cancel(
        { bookingId: reenter.bookingId, reason: t("flowko_desk_reenter_reason", { name }) },
        { toasts: "none" }
      );
      if (cancelled.kind === "done") showToast(t("flowko_desk_reentered", { name }), "success");
      else showToast(t("flowko_desk_reenter_both_exist", { name }), "warning");
    }
    onClose();
  }

  async function resendWithOverride(p: Pending) {
    if (busy) return;
    setBusy(true);
    try {
      await save({ ...p.payload, confirmOverride: true });
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (busy) return;
    let start: Ms;
    try {
      start = wallClockToMs(values.date, values.time, timeZone);
    } catch {
      form.setError("time", { message: "flowko_desk_required_time" });
      return;
    }
    await save({
      workerMemberId: values.memberId as number,
      serviceIds: values.serviceIds,
      start: new Date(start).toISOString(),
      customer: {
        name: values.customer.name,
        phone: values.customer.phone || null,
        email: values.customer.email || null,
      },
    });
  });

  const fieldError = (key: string | undefined) =>
    key ? (
      <p role="alert" className="text-error mt-1 text-sm">
        {t(key)}
      </p>
    ) : null;
  const pendingServices = pending
    ? pending.payload.serviceIds
        .map((id) => services.find((s) => s.id === id))
        .filter((s): s is (typeof services)[number] => s !== undefined)
    : [];

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent aria-describedby={undefined}>
        <form noValidate onSubmit={onSubmit} className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>{t(reenter ? "flowko_desk_reenter" : "flowko_desk_book_title")}</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-5">
            {target.kind === "reenter" ? (
              <div>
                <label
                  htmlFor="flowko-desk-sheet-worker"
                  className="text-emphasis mb-2 block text-sm font-medium">
                  {t("flowko_desk_worker")}
                </label>
                <select
                  id="flowko-desk-sheet-worker"
                  className="border-default bg-default text-emphasis h-10 w-full rounded-md border px-2 text-sm"
                  {...form.register("memberId", {
                    setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
                  })}>
                  <option value="">{t("flowko_desk_choose_worker")}</option>
                  {workerChoices.map((c) => (
                    <option key={c.memberId} value={c.memberId}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
                {fieldError(errors.memberId?.message)}
              </div>
            ) : (
              <p data-testid="desk-sheet-worker" className="text-emphasis text-sm">
                {t("flowko_desk_worker")}:{" "}
                <span className="font-semibold">{workerName(target.memberId)}</span>
              </p>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-emphasis text-sm font-medium">{t("flowko_desk_services")}</span>
              {reenter && reenter.serviceIds === null && (
                <p className="text-attention text-sm">{t("flowko_desk_reenter_services_gone")}</p>
              )}
              {memberId !== null && offered.length === 0 && (
                <p className="text-subtle text-sm">{t("flowko_desk_services_none")}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {offered.map((s) => {
                  const order = selected.indexOf(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={order >= 0}
                      onClick={() => toggle(s.id)}
                      className={classNames(
                        "flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium",
                        order >= 0
                          ? "bg-brand-default text-brand border-brand-default"
                          : "border-default bg-default text-emphasis hover:bg-subtle"
                      )}>
                      {order >= 0 && (
                        <span aria-hidden className="tabular-nums">
                          {order + 1}.
                        </span>
                      )}
                      {s.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-subtle text-xs">{t("flowko_desk_services_hint")}</p>
              {fieldError(errors.serviceIds?.message)}
            </div>

            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <TextField type="date" label={t("date")} {...form.register("date")} />
                <TextField
                  type="time"
                  label={t("time")}
                  step={(ctx.view?.slotStepMinutes ?? 15) * 60}
                  {...form.register("time")}
                />
              </div>
              {fieldError(errors.date?.message ?? errors.time?.message)}
              <FreeStartChips
                date={form.watch("date")}
                serviceIds={selected}
                memberId={memberId}
                timeZone={timeZone}
                value={form.watch("time")}
                onPick={(time) => form.setValue("time", time, { shouldValidate: form.formState.isSubmitted })}
              />
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-emphasis text-sm font-medium">{t("flowko_desk_customer")}</span>
              {customerMode === "card" ? (
                <CustomerCard
                  customer={{
                    name: customer.name,
                    phone: customer.phone || null,
                    email: customer.email || null,
                  }}
                  onChange={changeCustomer}
                />
              ) : (
                <CustomerField onPick={pickCustomer} onNew={newCustomer} />
              )}
              {customerMode === "new" && (
                <>
                  <TextField
                    label={t("flowko_desk_customer_name")}
                    maxLength={80}
                    {...form.register("customer.name")}
                  />
                  {fieldError(errors.customer?.name?.message)}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <TextField
                      type="tel"
                      label={t("flowko_desk_customer_phone")}
                      maxLength={32}
                      {...form.register("customer.phone")}
                    />
                    <TextField
                      type="email"
                      label={t("flowko_desk_customer_email")}
                      maxLength={254}
                      {...form.register("customer.email")}
                    />
                  </div>
                  {fieldError(errors.customer?.phone?.message ?? errors.customer?.email?.message)}
                </>
              )}
              {/* Flowko U28b: a server refusal of a carded customer (bad_customer, a contact-less old one) shows here. */}
              {customerMode === "card" &&
                fieldError(
                  errors.customer?.name?.message ??
                    errors.customer?.phone?.message ??
                    errors.customer?.email?.message
                )}
            </div>
          </SheetBody>
          <SheetFooter>
            <Button color="secondary" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" loading={isSubmitting || busy} disabled={busy || !customerReady}>
              {t("save")}
            </Button>
          </SheetFooter>
        </form>
        <ConfirmProblemsDialog
          open={pending !== null}
          problems={pending?.problems ?? []}
          googleUnavailable={pending?.googleUnavailable ?? false}
          stepNames={stepNamesOf(pendingServices)}
          timeZone={timeZone}
          busy={busy}
          onConfirm={() => {
            if (pending) void resendWithOverride(pending);
          }}
          onClose={() => setPending(null)}
        />
      </SheetContent>
    </Sheet>
  );
}
