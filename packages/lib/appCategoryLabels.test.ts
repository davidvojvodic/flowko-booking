import { describe, expect, it } from "vitest";

import { APP_CATEGORY_IDS, getAppCategoryLabel, getCategoryAppsTitle, getNoCategoryAppsHeadline } from "./appCategoryLabels";
import { realTranslator } from "./testUtils/realTranslator";

describe("app category labels (Flowko U14)", () => {
  it("never mixes a raw category id into a Slovene sentence", () => {
    const { t } = realTranslator("sl");
    expect(getCategoryAppsTitle(t, "calendar")).toBe("Koledarske aplikacije");
    expect(getNoCategoryAppsHeadline(t, "payment")).toBe("Ni plačilnih aplikacij");
    expect(getCategoryAppsTitle(t, null)).toBe("Vse aplikacije");
    for (const id of APP_CATEGORY_IDS) {
      for (const text of [
        getAppCategoryLabel(t, id),
        getCategoryAppsTitle(t, id),
        getNoCategoryAppsHeadline(t, id),
      ]) {
        expect(text).not.toMatch(/^(app_category_|category_apps_|no_category_apps_)/);
        expect(text).not.toMatch(/\b(Calendar|calendar|payment|analytics|automation|messaging)\b/);
      }
    }
  });

  it("reads naturally in English", () => {
    const { t } = realTranslator("en");
    expect(getCategoryAppsTitle(t, "calendar")).toBe("Calendar apps");
    expect(getNoCategoryAppsHeadline(t, "analytics")).toBe("No analytics apps");
    expect(getAppCategoryLabel(t, "crm")).toBe("CRM");
  });

  it("keeps the generic sentence for an unknown category", () => {
    const { t } = realTranslator("en");
    expect(getCategoryAppsTitle(t, "weather")).toBe("Weather apps");
    expect(getNoCategoryAppsHeadline(t, "weather")).toBe("No weather apps");
  });
});
