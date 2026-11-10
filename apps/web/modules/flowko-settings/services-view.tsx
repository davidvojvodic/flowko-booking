// Flowko U29a: the services page (S8–S13, S17), owner only (the page guards; the API refuses anyone else). Reads
// viewer.flowko.services.list (no suspense, no server initial data) and lists the services in position order: name
// (and category), total minutes, the steps as a small bar (busy solid, processing hatched), who does it („Nihče“
// when nobody; a LOCKED member marked as on the desk), up/down buttons (always visible; each sends the whole new
// order, and a stale list answers bad_service → refetch and say so) and „Uredi“. „Nova storitev“ and „Uredi“ open
// the ServiceSheet; an empty catalogue shows the empty state. Every service write invalidates services.list, the
// desk's business.services and bookings.freeStarts (S17). Flowko U29c: a failed refresh shows an inline notice with
// „Osveži“; a corrupt service is listed with a damaged-steps text (P1, P4, P8).
"use client";

import type { OwnerService } from "@calcom/features/flowkoBusiness/services";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Alert } from "@calcom/ui/components/alert";
import { Button } from "@calcom/ui/components/button";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";
import { SkeletonText } from "@calcom/ui/components/skeleton";
import { showToast } from "@calcom/ui/components/toast";
import { refreshAfterSave } from "@calcom/web/lib/flowko/refreshAfterSave";
import { useState } from "react";
import { ServiceSheet, serviceErrorCode, serviceErrorKey } from "./ServiceSheet";
import { isLocked } from "./ServiceWorkers";
import { StepsBar } from "./StepsEditor";

type SheetState = { kind: "new" } | { kind: "edit"; service: OwnerService } | null;

const byPosition = (a: OwnerService, b: OwnerService) => a.position - b.position || a.id - b.id;

const BOX = "border-subtle rounded-b-xl border border-t-0 px-4 py-8 sm:px-6";

export default function ServicesView() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const query = trpc.viewer.flowko.services.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const reorder = trpc.viewer.flowko.services.reorder.useMutation();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [reordering, setReordering] = useState(false);

  // S17: the catalogue here, the desk's service list and its free starts.
  // Flowko U29c (P1): services.list is the probe (invalidated with throwOnError, so it rejects when its refetch
  // fails); the other two only run alongside. A failed probe raises the inline notice; nothing is blocked (saves
  // carry no version, a stale reorder answers bad_service + refetch). A saved write is never undone by it.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const probeList = () =>
    utils.viewer.flowko.services.list.invalidate(undefined, undefined, { throwOnError: true });
  const invalidate = async () => {
    const ok = await refreshAfterSave(probeList, [
      () => utils.viewer.flowko.business.services.invalidate(),
      () => utils.viewer.flowko.bookings.freeStarts.invalidate(),
    ]);
    setRefreshFailed(!ok);
    return ok;
  };
  async function retryRefresh() {
    setRetrying(true);
    try {
      setRefreshFailed(!(await refreshAfterSave(probeList, [])));
    } finally {
      setRetrying(false);
    }
  }

  if (!query.data) {
    if (query.error) {
      return (
        <div className={`${BOX} flex flex-col items-start gap-3`}>
          <p className="text-error text-sm">{t("flowko_settings_services_load_error")}</p>
          <Button color="secondary" onClick={() => void query.refetch()}>
            {t("try_again")}
          </Button>
        </div>
      );
    }
    return (
      <div data-testid="flowko-settings-services-loading" className={`${BOX} flex flex-col gap-6`}>
        <SkeletonText className="h-8 w-full" />
        <SkeletonText className="h-8 w-full" />
        <SkeletonText className="h-8 w-full" />
      </div>
    );
  }

  const { members } = query.data;
  const services = query.data.services.slice().sort(byPosition);

  async function move(index: number, delta: -1 | 1) {
    const ids = services.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    setReordering(true);
    try {
      await reorder.mutateAsync({ serviceIds: ids });
    } catch (error) {
      const code = serviceErrorCode(error);
      try {
        if (code === "bad_service") {
          // S13: the list was not exactly the business's services (another device added or removed one).
          showToast(t("flowko_settings_service_order_changed"), "error");
          await query.refetch();
        } else {
          showToast(t(serviceErrorKey(code)), "error");
        }
      } finally {
        setReordering(false);
      }
      return;
    }
    // Flowko U29b: the arrows stay off until the refreshed list is in (D1 c); the next move starts from it.
    // Flowko U29c (P8): the reorder went through, so it says so, whatever the refresh answered (P1).
    await invalidate();
    setReordering(false);
    showToast(t("saved"), "success");
  }

  const workersText = (service: OwnerService) => {
    const names = service.workers
      .filter((w) => w.assigned)
      .map((w) => (isLocked(w) ? t("flowko_desk_locked_column", { name: w.displayName }) : w.displayName));
    return names.length > 0 ? names.join(", ") : t("flowko_settings_service_nobody");
  };

  // The sheet edits the fresh copy of its service (a refetch updates who may be ticked); a service removed
  // meanwhile keeps the copy the sheet opened with.
  const sheetTarget =
    sheet?.kind === "edit"
      ? { kind: "edit" as const, service: services.find((s) => s.id === sheet.service.id) ?? sheet.service }
      : sheet;

  return (
    <div className={BOX}>
      {refreshFailed && (
        <div data-testid="flowko-settings-refresh-failed" className="mb-4">
          <Alert
            severity="warning"
            title={t("flowko_settings_refresh_failed")}
            actions={
              <Button type="button" color="secondary" loading={retrying} onClick={() => void retryRefresh()}>
                {t("flowko_settings_refresh")}
              </Button>
            }
          />
        </div>
      )}
      {services.length === 0 ? (
        <EmptyScreen
          Icon="layers"
          headline={t("flowko_settings_services_empty_title")}
          description={t("flowko_settings_services_empty_body")}
          buttonRaw={
            <Button color="primary" StartIcon="plus" onClick={() => setSheet({ kind: "new" })}>
              {t("flowko_settings_service_new")}
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex justify-end">
            <Button color="primary" StartIcon="plus" onClick={() => setSheet({ kind: "new" })}>
              {t("flowko_settings_service_new")}
            </Button>
          </div>
          <ul className="divide-subtle mt-4 divide-y">
            {services.map((service, index) => (
              <li
                key={service.id}
                data-testid={`flowko-service-row-${service.id}`}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-emphasis font-medium">{service.name}</span>
                    {service.category && <span className="text-subtle text-xs">{service.category}</span>}
                  </div>
                  {/* Flowko U29c (P4): corrupt stored steps: no total or bar, only the way out. */}
                  {service.broken ? (
                    <p className="text-error text-sm">{t("flowko_settings_service_broken")}</p>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span data-testid="flowko-service-total" className="text-default text-sm tabular-nums">
                        {t("flowko_settings_service_minutes", { minutes: service.totalMinutes })}
                      </span>
                      <StepsBar steps={service.steps} />
                    </div>
                  )}
                  <span data-testid="flowko-service-workers" className="text-subtle text-sm">
                    {workersText(service)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="icon"
                    color="minimal"
                    StartIcon="arrow-up"
                    aria-label={t("flowko_settings_service_move_up", { name: service.name })}
                    disabled={index === 0 || reordering}
                    onClick={() => void move(index, -1)}
                  />
                  <Button
                    type="button"
                    variant="icon"
                    color="minimal"
                    StartIcon="arrow-down"
                    aria-label={t("flowko_settings_service_move_down", { name: service.name })}
                    disabled={index === services.length - 1 || reordering}
                    onClick={() => void move(index, 1)}
                  />
                  <Button
                    type="button"
                    color="secondary"
                    aria-label={t("flowko_settings_service_edit_label", { name: service.name })}
                    onClick={() => setSheet({ kind: "edit", service })}>
                    {t("flowko_settings_service_edit")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {sheetTarget && (
        <ServiceSheet
          key={sheetTarget.kind === "edit" ? sheetTarget.service.id : "new"}
          target={sheetTarget}
          members={members}
          onClose={() => setSheet(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}
