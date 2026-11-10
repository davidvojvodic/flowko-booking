// Flowko U29b (Task 7, S8, D13, Ruling R3): the holiday label in a day header of Urnik („Božič – zaprto“, the desk's
// texts). Everyone sees the label; the owner (`canManage`: date today…today+371, week mode) gets a small menu with
// „Odpri ta dan“ (closed) or „Zapri ta dan“ (open), saved at once through roster.setHolidayOpen and followed by a
// refresh of the roster, the desk and the business settings. With the business's closing switch off every holiday is
// open and closing has no effect, so the menu says so and links to the settings instead. While the week has unsaved
// edits the action is disabled with a hint (the refresh would drop them).
import { useState } from "react";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@calcom/ui/components/popover";
import { showToast } from "@calcom/ui/components/toast";

import { useInvalidateRoster } from "./useRosterData";

const LABEL_CLASS = "text-attention max-w-full truncate text-xs font-normal";

export function RosterHolidayMenu(props: {
  date: string;
  holiday: { name: string; open: boolean };
  holidaysClosed: boolean;
  /** The owner, a date inside the writable window, week mode. */
  canManage: boolean;
  /** The draft holds unsaved edits. */
  dirty: boolean;
}) {
  const { t } = useLocale();
  const { date, holiday } = props;
  const setHolidayOpen = trpc.viewer.flowko.roster.setHolidayOpen.useMutation();
  const invalidate = useInvalidateRoster();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = t(holiday.open ? "flowko_desk_holiday_open" : "flowko_desk_holiday_closed", {
    name: holiday.name,
  });

  if (!props.canManage) {
    return (
      <span data-testid={`roster-holiday-${date}`} className={LABEL_CLASS}>
        {label}
      </span>
    );
  }

  const change = async () => {
    if (busy || props.dirty) return;
    setBusy(true);
    try {
      await setHolidayOpen.mutateAsync({ date, open: !holiday.open });
      await invalidate({ settings: true });
      setMenuOpen(false);
    } catch {
      showToast(t("flowko_roster_holiday_error"), "error");
      await Promise.resolve(invalidate({ settings: true })).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`roster-holiday-${date}`}
          className={`${LABEL_CLASS} hover:bg-subtle rounded text-left underline decoration-dotted`}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex flex-col gap-3 text-sm">
        {!props.holidaysClosed ? (
          <>
            <p className="text-default">{t("flowko_roster_holiday_off_hint")}</p>
            <a className="text-emphasis underline" href="/settings/podjetje/profil">
              {t("flowko_roster_holiday_off_link")}
            </a>
          </>
        ) : (
          <>
            <Button
              color="secondary"
              className="justify-center"
              disabled={props.dirty}
              loading={busy}
              onClick={() => void change()}>
              {t(holiday.open ? "flowko_roster_close_day" : "flowko_roster_open_day")}
            </Button>
            {props.dirty && <p className="text-subtle text-xs">{t("flowko_roster_holiday_dirty_hint")}</p>}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
