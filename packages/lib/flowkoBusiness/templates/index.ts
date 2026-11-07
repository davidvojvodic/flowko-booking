// Flowko U25: business templates (R12). A template seeds a new business's opening hours, slot grid and services;
// the owner edits them afterwards. Pure and client-safe (U29 self-service reads them in-app).
import type { ServiceStep } from "@calcom/lib/flowkoSalon";
import type { OpeningHours } from "../schemas";
import { hairSalonTemplate } from "./hairSalon";

export type FlowkoTemplateId = "hair-salon";
export type FlowkoTemplateService = {
  name: string;
  category: string;
  steps: ServiceStep[];
  priceCents: number | null;
};
export type FlowkoBusinessTemplate = {
  id: FlowkoTemplateId;
  slotGridMinutes: number;
  openingHours: OpeningHours;
  services: FlowkoTemplateService[];
};

export const FLOWKO_TEMPLATES: Record<FlowkoTemplateId, FlowkoBusinessTemplate> = {
  "hair-salon": hairSalonTemplate,
};

/** The template with this id, or null (own keys only: "toString" or "__proto__" are not templates). */
export function getFlowkoTemplate(id: string): FlowkoBusinessTemplate | null {
  return Object.hasOwn(FLOWKO_TEMPLATES, id) ? FLOWKO_TEMPLATES[id as FlowkoTemplateId] : null;
}
