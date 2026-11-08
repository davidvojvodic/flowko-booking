// Flowko U28: the override dialog (R7, R8). One line per fit problem: the step's service name (a problem's `step`
// indexes the placed steps of the services in tap order, as the writer concatenates them) and the conflicting
// time where the problem has one. When Google could not be read (R7) the calendar-overlap lines give way to one
// „Google koledar trenutno ni dosegljiv“ line. „Vseeno shrani“ resends with `confirmOverride: true` (the caller).
import { formatHm, problemKey } from "@calcom/lib/flowkoBusiness/desk";
import type { FitProblem } from "@calcom/lib/flowkoSalon";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { ConfirmationDialogContent, Dialog } from "@calcom/ui/components/dialog";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** One service name per placed step, services in tap order (bookingDay `combinedSteps`). */
export function stepNamesOf(services: Array<{ name: string; steps: unknown[] }>): string[] {
  return services.flatMap((s) => s.steps.map(() => s.name));
}

export function problemLines(
  problems: FitProblem[],
  googleUnavailable: boolean,
  stepNames: string[],
  timeZone: string,
  t: T,
  /** The name for a step index the caller cannot name (e.g. a booking whose step copy is not trusted). */
  fallbackName = ""
): string[] {
  const lines: string[] = [];
  for (const p of problems) {
    if (googleUnavailable && p.kind === "overlaps_external") continue;
    const service = "step" in p ? (stepNames[p.step] ?? fallbackName) : "";
    const time =
      "with" in p ? { from: formatHm(p.with.start, timeZone), to: formatHm(p.with.end, timeZone) } : {};
    lines.push(t(problemKey(p), { service, ...time }));
  }
  if (googleUnavailable) lines.push(t("flowko_desk_problem_google_unavailable"));
  return Array.from(new Set(lines));
}

export function ConfirmProblemsDialog(props: {
  open: boolean;
  problems: FitProblem[];
  googleUnavailable: boolean;
  stepNames: string[];
  timeZone: string;
  fallbackName?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const lines = problemLines(
    props.problems,
    props.googleUnavailable,
    props.stepNames,
    props.timeZone,
    t,
    props.fallbackName
  );
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <ConfirmationDialogContent
        variety="warning"
        title={t("flowko_desk_confirm_title")}
        confirmBtnText={t("flowko_desk_confirm_save")}
        cancelBtnText={t("cancel")}
        onConfirm={props.onConfirm}>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {lines.map((line) => (
            <li key={line} data-testid="desk-problem">
              {line}
            </li>
          ))}
        </ul>
      </ConfirmationDialogContent>
    </Dialog>
  );
}
