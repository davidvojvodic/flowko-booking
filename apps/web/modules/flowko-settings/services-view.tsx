// Flowko U29a: the services page (S8–S13, S17), owner only (the page guards; the API refuses anyone else). Reads
// viewer.flowko.services.list (no suspense, no server initial data) and lists the services in position order: name
// (and category), total minutes, the steps as a small bar (busy solid, processing hatched), who does it („Nihče“
// when nobody; a LOCKED member marked as on the desk), up/down buttons (always visible; each sends the whole new
// order, and a stale list answers bad_service → refetch and say so) and „Uredi“. „Nova storitev“ and „Uredi“ open
// the ServiceSheet; an empty catalogue shows the empty state. Every service write invalidates services.list, the
// desk's business.services and bookings.freeStarts (S17).
"use client";

import type { OwnerService } from "@calcom/features/flowkoBusiness/services";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";
import { SkeletonText } from "@calcom/ui/components/skeleton";
import { showToast } from "@calcom/ui/components/toast";
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
  const invalidate = () =>
    Promise.all([
      utils.viewer.flowko.services.list.invalidate(),
      utils.viewer.flowko.business.services.invalidate(),
      utils.viewer.flowko.bookings.freeStarts.invalidate(),
    ]).catch(() => undefined);

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
      if (code === "bad_service") {
        // S13: the list was not exactly the business's services (another device added or removed one).
        showToast(t("flowko_settings_service_order_changed"), "error");
        await query.refetch();
      } else {
        showToast(t(serviceErrorKey(code)), "error");
      }
      return;
    } finally {
      setReordering(false);
    }
    await invalidate();
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
                  <div className="flex items-center gap-3">
                    <span data-testid="flowko-service-total" className="text-default text-sm tabular-nums">
                      {t("flowko_settings_service_minutes", { minutes: service.totalMinutes })}
                    </span>
                    <StepsBar steps={service.steps} />
                  </div>
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
