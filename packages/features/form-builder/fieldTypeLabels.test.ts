import { describe, expect, it } from "vitest";

import { realTranslator } from "@calcom/lib/testUtils/realTranslator";

import { fieldTypesConfigMap } from "./fieldTypes";
import { FIELD_TYPE_LABEL_KEYS, getFieldTypeLabel, getSourceBadgeLabel } from "./fieldTypeLabels";

describe("field type labels (Flowko U14)", () => {
  it("covers every field type the config map has", () => {
    expect([...FIELD_TYPE_LABEL_KEYS].sort()).toEqual(Object.keys(fieldTypesConfigMap).sort());
  });

  it("never prints the English config label in Slovene", () => {
    const { t } = realTranslator("sl");
    const english = ["Short Text", "Long Text", "Multiple Emails", "Radio Input", "Checkbox Group", "MultiSelect"];
    for (const fieldType of Object.values(fieldTypesConfigMap)) {
      const label = getFieldTypeLabel(t, fieldType);
      expect(label).not.toBe(`field_type_${fieldType.value}`);
      expect(english).not.toContain(label);
    }
    expect(getFieldTypeLabel(t, fieldTypesConfigMap.textarea)).toBe("Dolgo besedilo");
    expect(getFieldTypeLabel(t, fieldTypesConfigMap.multiemail)).toBe("Več e-poštnih naslovov");
  });

  it("says the English wording in English", () => {
    const { t } = realTranslator("en");
    expect(getFieldTypeLabel(t, fieldTypesConfigMap.textarea)).toBe("Long text");
    expect(getFieldTypeLabel(t, fieldTypesConfigMap.boolean)).toBe("Checkbox");
  });

  it("uses the Slovene plural forms for the location badge", () => {
    const { t } = realTranslator("sl");
    expect(getSourceBadgeLabel(t, "Location", 1)).toBe("1 lokacija");
    expect(getSourceBadgeLabel(t, "Location", 2)).toBe("2 lokaciji");
    expect(getSourceBadgeLabel(t, "Location", 3)).toBe("3 lokacije");
    expect(getSourceBadgeLabel(t, "Location", 4)).toBe("4 lokacije");
    expect(getSourceBadgeLabel(t, "Location", 5)).toBe("5 lokacij");
  });

  it("uses singular and plural in English and keeps the old text for another source", () => {
    const { t } = realTranslator("en");
    expect(getSourceBadgeLabel(t, "Location", 1)).toBe("1 location");
    expect(getSourceBadgeLabel(t, "Location", 2)).toBe("2 locations");
    expect(getSourceBadgeLabel(t, "Workflow", 1)).toBe("1 Workflow");
    expect(getSourceBadgeLabel(t, "Workflow", 2)).toBe("2 Workflows");
  });
});
