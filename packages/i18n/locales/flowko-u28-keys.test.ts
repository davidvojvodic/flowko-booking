import { describe, expect, it } from "vitest";

import en from "./en/common.json";
import sl from "./sl/common.json";

// Flowko U28: every string key the desk added (Tasks 3 and 5 to 8) exists in en and sl with the same
// {{placeholders}}. The test checks keys and placeholders, not texts: the Slovene wording may change.

const enKeys = en as Record<string, string>;
const slKeys = sl as Record<string, string>;

const U28_KEYS = [
  "flowko_desk_error_in_past",
  "flowko_desk_error_booking_not_started",
  "flowko_desk_nav",
  "flowko_desk_title",
  "flowko_desk_subtitle",
  "flowko_desk_actor_chip",
  "flowko_desk_actor_choose",
  "flowko_desk_actor_hint",
  "flowko_desk_prev_day",
  "flowko_desk_next_day",
  "flowko_desk_view_day",
  "flowko_desk_view_week",
  "flowko_desk_worker",
  "flowko_desk_locked_column",
  "flowko_desk_busy",
  "flowko_desk_time_off",
  "flowko_desk_google_unavailable",
  "flowko_desk_holiday_closed",
  "flowko_desk_holiday_open",
  "flowko_desk_no_columns",
  "flowko_desk_load_error",
  "flowko_desk_book_title",
  "flowko_desk_reenter",
  "flowko_desk_reenter_services_gone",
  "flowko_desk_reenter_reason",
  "flowko_desk_reentered",
  "flowko_desk_reenter_both_exist",
  "flowko_desk_choose_worker",
  "flowko_desk_services",
  "flowko_desk_services_hint",
  "flowko_desk_services_none",
  "flowko_desk_free_starts",
  "flowko_desk_free_starts_none",
  "flowko_desk_free_starts_hint",
  "flowko_desk_customer",
  "flowko_desk_customer_search",
  "flowko_desk_customer_none",
  "flowko_desk_customer_new",
  "flowko_desk_customer_name",
  "flowko_desk_customer_phone",
  "flowko_desk_customer_email",
  "flowko_desk_required_worker",
  "flowko_desk_required_services",
  "flowko_desk_required_time",
  "flowko_desk_required_name",
  "flowko_desk_required_contact",
  "flowko_desk_created",
  "flowko_desk_moved",
  "flowko_desk_cancelled",
  "flowko_desk_no_show_marked",
  "flowko_desk_no_show_undone",
  "flowko_desk_confirm_title",
  "flowko_desk_confirm_save",
  "flowko_desk_problem_outside_opening",
  "flowko_desk_problem_off_grid",
  "flowko_desk_problem_too_soon",
  "flowko_desk_problem_outside_shift",
  "flowko_desk_problem_time_off",
  "flowko_desk_problem_overlaps_booking",
  "flowko_desk_problem_overlaps_external",
  "flowko_desk_problem_google_unavailable",
  "flowko_desk_error_duplicate_time",
  "flowko_desk_error_booking_not_active",
  "flowko_desk_error_worker_locked",
  "flowko_desk_error_service_not_assigned",
  "flowko_desk_error_bad_booking",
  "flowko_desk_error_bad_customer",
  "flowko_desk_error_forbidden",
  "flowko_desk_error_TOO_MANY_REQUESTS",
  "flowko_desk_steps",
  "flowko_desk_step_busy",
  "flowko_desk_step_processing",
  "flowko_desk_history",
  "flowko_desk_history_created",
  "flowko_desk_history_rescheduled",
  "flowko_desk_history_cancelled",
  "flowko_desk_history_no_show",
  "flowko_desk_history_no_show_undone",
  "flowko_desk_history_overrides",
  "flowko_desk_history_unknown_actor",
  "flowko_desk_override_outside_opening",
  "flowko_desk_override_off_grid",
  "flowko_desk_override_too_soon",
  "flowko_desk_override_outside_shift",
  "flowko_desk_override_time_off",
  "flowko_desk_override_overlaps_booking",
  "flowko_desk_override_overlaps_external",
  "flowko_desk_move",
  "flowko_desk_cancel_booking",
  "flowko_desk_cancel_reason",
  "flowko_desk_no_show_mark",
  "flowko_desk_no_show_undo",
  "flowko_desk_error_forbidden_self",
  "flowko_desk_prev_week",
  "flowko_desk_next_week",
  "flowko_desk_week_phone_hint",
  "flowko_desk_no_show_mark_action",
  // Flowko U28b: the customer card's „Zamenjaj“ (B2).
  "flowko_desk_customer_change",
  // Flowko U28c: the move panel in the booking sheet and the clearer calendar move banner (M2, M3, M5).
  "flowko_desk_move_panel_title",
  "flowko_desk_move_confirm",
  "flowko_desk_move_on_calendar",
  "flowko_desk_move_banner_column",
  "flowko_desk_move_services_gone",
  // Flowko U28c (review): the banner when no worker name is known (names the customer).
  "flowko_desk_move_banner",
];

const placeholders = (text: string): string[] =>
  Array.from(new Set(Array.from(text.matchAll(/{{\s*(\w+)\s*}}/g), (m) => m[1]))).sort();

describe("U28 desk keys", () => {
  it("lists each key once", () => {
    expect(new Set(U28_KEYS).size).toBe(U28_KEYS.length);
  });

  it.each(U28_KEYS)("%s exists in en and sl", (key) => {
    expect(typeof enKeys[key]).toBe("string");
    expect(enKeys[key].length).toBeGreaterThan(0);
    expect(typeof slKeys[key]).toBe("string");
    expect(slKeys[key].length).toBeGreaterThan(0);
  });

  it.each(U28_KEYS)("%s has the same placeholders in en and sl", (key) => {
    expect(placeholders(slKeys[key])).toEqual(placeholders(enKeys[key]));
  });

  it("the desk keys in the files are exactly this list", () => {
    const inFiles = Object.keys(enKeys).filter((key) => key.startsWith("flowko_desk_"));
    expect(new Set(inFiles)).toEqual(new Set(U28_KEYS.filter((key) => key.startsWith("flowko_desk_"))));
  });
});
