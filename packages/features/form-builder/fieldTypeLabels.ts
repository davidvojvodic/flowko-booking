type Translate = (key: string, options?: Record<string, unknown>) => string;

// Flowko U14: the config map in fieldTypes.ts carries English labels. The two places that print them (the grey
// line under each booking question and the "Input type" dropdown) go through this helper, so they follow the
// UI language. The key is derived from the field type's `value`, e.g. `field_type_multiemail`.
export const FIELD_TYPE_LABEL_KEYS = [
  "name",
  "email",
  "phone",
  "address",
  "text",
  "number",
  "textarea",
  "select",
  "multiselect",
  "multiemail",
  "radioInput",
  "checkbox",
  "radio",
  "boolean",
  "url",
] as const;

export function getFieldTypeLabel(t: Translate, fieldType: { value: string; label: string }): string {
  return (FIELD_TYPE_LABEL_KEYS as readonly string[]).includes(fieldType.value)
    ? t(`field_type_${fieldType.value}`)
    : fieldType.label;
}

/**
 * The blue badge next to a booking question that counts where its options come from. The source label is
 * stored data ("Location"), so only the known one is translated, with the language's plural forms; any other
 * label keeps the old English "<n> <label>s" text.
 */
export function getSourceBadgeLabel(t: Translate, sourceLabel: string, count: number): string {
  if (sourceLabel === "Location") {
    return t("location_count", { count });
  }
  return `${count} ${count === 1 ? sourceLabel : `${sourceLabel}s`}`;
}
