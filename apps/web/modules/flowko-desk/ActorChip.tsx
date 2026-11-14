// Flowko U28: the „who are you“ chip (R9), in the page body so it shows on a phone too (the shell hides the page
// heading below md). A WORKER's chip is a plain label; on a shared device it opens the picker, a list of big
// buttons (one per ACTIVE member) suited to a tablet.
// Flowko U28b (B1): the chip always names the effective actor (the signed-in member unless this device chose someone
// else); no „Kdo ste?“ prompt on it. The picker lists the signed-in member too: choosing her goes back to herself.
// While the actor is not known yet (member list loading) no chip is shown.
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";
import { Button } from "@calcom/ui/components/button";
import { Dialog, DialogContent } from "@calcom/ui/components/dialog";
import { Icon } from "@calcom/ui/components/icon";
import { RAW } from "@calcom/web/lib/flowko/i18nRaw";

import type { DeskActorState } from "./useDeskActor";

export function ActorChip({ actor }: { actor: DeskActorState }) {
  const { t } = useLocale();
  if (!actor.actor) return null;
  // Flowko U29e (E10.1): RAW, so „Ana & Maja“ shows once.
  const label = t("flowko_desk_actor_chip", { name: actor.actor.displayName, ...RAW });

  return (
    <>
      {actor.fixed ? (
        <span
          data-testid="desk-actor-chip"
          className="bg-subtle text-emphasis inline-flex h-9 items-center rounded-md px-3 text-sm font-medium">
          {label}
        </span>
      ) : (
        <Button data-testid="desk-actor-chip" color="secondary" StartIcon="user" onClick={actor.openPicker}>
          {label}
        </Button>
      )}
      {!actor.fixed && (
        <Dialog open={actor.pickerOpen} onOpenChange={(open) => (open ? actor.openPicker() : actor.closePicker())}>
          <DialogContent title={t("flowko_desk_actor_choose")} description={t("flowko_desk_actor_hint")}>
            <div className="grid grid-cols-1 gap-2 pb-8 sm:grid-cols-2">
              {actor.choices.map((m) => {
                const selected = actor.actor?.memberId === m.memberId;
                return (
                  <button
                    key={m.memberId}
                    type="button"
                    data-testid={`desk-actor-option-${m.memberId}`}
                    aria-pressed={selected}
                    onClick={() => actor.choose(m.memberId)}
                    className={classNames(
                      "border-subtle text-emphasis flex min-h-12 items-center justify-between rounded-lg border px-4 text-left text-base font-medium",
                      selected ? "bg-emphasis" : "bg-default hover:bg-subtle"
                    )}>
                    {m.displayName}
                    {selected && <Icon name="check" className="h-4 w-4" />}
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
