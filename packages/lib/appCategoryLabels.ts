type Translate = (key: string, options?: Record<string, unknown>) => string;

// Flowko U14: the app store's category is a raw id ("calendar", "payment"). Slovene cannot build "Apps <id>" or
// "No <id> apps" by inserting a word, so each known category has its own keys:
// app_category_<id>, category_apps_<id>, no_category_apps_<id>. An unknown category keeps the generic sentence.
export const APP_CATEGORY_IDS = [
  "calendar",
  "messaging",
  "other",
  "payment",
  "video",
  "web3",
  "automation",
  "analytics",
  "conferencing",
  "crm",
] as const;

const isKnown = (category: string | null | undefined): category is (typeof APP_CATEGORY_IDS)[number] =>
  !!category && (APP_CATEGORY_IDS as readonly string[]).includes(category.toLowerCase());

const capitalise = (category: string) =>
  category.toLowerCase() === "crm" ? "CRM" : category[0].toUpperCase() + category.slice(1);

/** The category's name, e.g. "Koledar". */
export function getAppCategoryLabel(t: Translate, category: string): string {
  return isKnown(category) ? t(`app_category_${category.toLowerCase()}`) : capitalise(category);
}

/** The heading of a category's app list, e.g. "Koledarske aplikacije"; no category means all apps. */
export function getCategoryAppsTitle(t: Translate, category: string | null | undefined): string {
  if (!category) return t("category_apps_all");
  return isKnown(category)
    ? t(`category_apps_${category.toLowerCase()}`)
    : t("category_apps", { category: capitalise(category) });
}

/** The empty-state headline, e.g. "Ni koledarskih aplikacij". */
export function getNoCategoryAppsHeadline(t: Translate, category: string): string {
  return isKnown(category)
    ? t(`no_category_apps_${category.toLowerCase()}`)
    : t("no_category_apps", { category: category.toLowerCase() });
}
