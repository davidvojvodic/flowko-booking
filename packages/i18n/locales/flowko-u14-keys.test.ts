import { describe, expect, it } from "vitest";

import en from "./en/common.json";
import sl from "./sl/common.json";

// Flowko U14 Task 4: the cancel wording.

const enKeys = en as Record<string, string>;
const slKeys = sl as Record<string, string>;

describe("cancel wording", () => {
  it("the generic cancel button is Prekliči in Slovene", () => {
    expect(slKeys.cancel).toBe("Prekliči");
    expect(enKeys.cancel).toBe("Cancel");
  });

  it("the booker's cancel link has its own key", () => {
    expect(slKeys.cancel_booking_link).toBe("Odpovej");
    expect(enKeys.cancel_booking_link).toBe("Cancel");
  });

  it("the old hidden embed help line is gone and the link key exists in both languages", () => {
    expect(enKeys.need_help_embedding).toBeUndefined();
    expect(slKeys.need_help_embedding).toBeUndefined();
    expect(enKeys.embed_help_link).toContain("<0>");
    expect(slKeys.embed_help_link).toContain("<0>");
  });
});

// Flowko U14 Task 5: every key the UI-text pass added exists in both languages, and the Slovene file has the
// plural forms where the English one has "_one"/"_other".
const TASK_5_KEYS = [
  "field_type_name",
  "field_type_email",
  "field_type_phone",
  "field_type_address",
  "field_type_text",
  "field_type_number",
  "field_type_textarea",
  "field_type_select",
  "field_type_multiselect",
  "field_type_multiemail",
  "field_type_radioInput",
  "field_type_checkbox",
  "field_type_radio",
  "field_type_boolean",
  "field_type_url",
  "location_count_one",
  "location_count_other",
  "split_full_name_toggle",
  "toggle_variant",
  "option_n",
  "editor_normal",
  "editor_numbered_list",
  "editor_bulleted_list",
  "editor_heading_large",
  "editor_heading_small",
  "editor_bold",
  "editor_italic",
  "editor_link",
  "error_page_headline",
  "error_page_description",
  "error_page_provide_text",
  "internal_server_error",
  "unexpected_error_occurred",
  "app_card_error",
  "cancellation_not_allowed_error",
  "cancellation_reason_required_error",
  "cancel_past_booking_error",
  "user_not_host_of_event_error",
  "no_show_before_start_error",
  "no_show_update_failed",
  "no_access_to_booking",
  "reschedule_within_notice_error",
  "invalid_event_length_error",
  "phone_number_invalid",
  "phone_or_email_required_error",
  "unable_to_load_users_error",
  "booker_email_blocked",
  "booker_email_requires_login",
  "unable_to_validate_verification_code",
  "booking_limits_ascending_error",
  "booker_limit_gt_zero_error",
  "duration_limits_ascending_error",
  "offset_start_nonnegative_error",
  "restriction_schedule_not_owned_error",
  "booking_already_confirmed",
  "not_authorized_to_confirm_booking",
  "booking_needs_organizer_error",
  "cannot_request_reschedule_cancelled",
  "not_booking_owner",
  "booking_already_reported",
  "booking_has_no_attendees",
  "guests_disabled_for_event_type",
  "you_do_not_have_permission",
  "reason_id_required",
  "only_admin_can_create_ooo",
  "only_admin_can_delete_ooo",
  "booking_redirect_not_found",
  "invalid_code",
  "error_forbidden",
  "error_not_found",
  "connect_calendar",
  "dates",
  "confirmed",
  "settings_navigation",
  "passed",
  "feedback_submitted_thanks",
  "unable_to_create_password_reset_request",
  "password_requirements_error",
  "password_hint_complexity",
  "login_method_email_password",
  "login_method_original",
  "error_code_label",
  "timezone_select",
  "previous_day",
  "next_day",
  "tabs",
  "clear_filter",
  "layout_preview",
  "nameless_user",
  "nameless_user_avatar",
  "user_avatar_alt",
  "nameless",
  "reset_to_default",
  "pick_colors",
  "edit_custom_name",
  "notifications_enabled_success",
  "notifications_disabled_success",
  "notifications_enable_failed",
  "notifications_disable_failed",
  "enable_google_services_push",
  "calendar_toggle_error",
  "settings_in_use",
  "add_new_calendars",
  "pick_a_date",
  "date_range_end",
  "installable_apps",
  "app_category_calendar",
  "category_apps_calendar",
  "no_category_apps_calendar",
  "app_category_messaging",
  "category_apps_messaging",
  "no_category_apps_messaging",
  "app_category_other",
  "category_apps_other",
  "no_category_apps_other",
  "app_category_payment",
  "category_apps_payment",
  "no_category_apps_payment",
  "app_category_video",
  "category_apps_video",
  "no_category_apps_video",
  "app_category_web3",
  "category_apps_web3",
  "no_category_apps_web3",
  "app_category_automation",
  "category_apps_automation",
  "no_category_apps_automation",
  "app_category_analytics",
  "category_apps_analytics",
  "no_category_apps_analytics",
  "app_category_conferencing",
  "category_apps_conferencing",
  "no_category_apps_conferencing",
  "app_category_crm",
  "category_apps_crm",
  "no_category_apps_crm",
  "category_apps_all",
  "placeholder_full_name",
  "placeholder_username",
  "default_app_updated_successfully",
  "cal_video_app_description",
  "google_calendar_scopes_missing",
];

describe("Task 5 keys", () => {
  it.each(TASK_5_KEYS)("%s exists in en and sl", (key) => {
    expect(typeof enKeys[key]).toBe("string");
    expect(typeof slKeys[key]).toBe("string");
    expect(slKeys[key].length).toBeGreaterThan(0);
  });

  it("the location badge has all four Slovene plural forms", () => {
    for (const form of ["one", "two", "few", "other"]) {
      expect(typeof slKeys[`location_count_${form}`]).toBe("string");
    }
    expect(enKeys.location_count_one).toBeDefined();
    expect(enKeys.location_count_other).toBeDefined();
  });

  it("keeps the placeholders of the sentences that take values", () => {
    for (const key of ["calendar_toggle_error", "app_card_error", "option_n", "user_avatar_alt"]) {
      const placeholder = (enKeys[key].match(/{{\s*(\w+)\s*}}/) ?? [])[1];
      expect(slKeys[key]).toContain(`{{${placeholder}}}`);
    }
  });
});
