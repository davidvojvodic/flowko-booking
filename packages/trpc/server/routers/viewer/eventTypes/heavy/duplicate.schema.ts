import type { z } from "zod";

import { EventTypeDuplicateInput } from "@calcom/features/eventtypes/lib/schemas";

import { refuseReservedEventTypeSlug } from "./reservedSlug";

// Flowko (U13 hardening): no slug that collides with the embed route or a rewrite (see ./reservedSlug).
export const ZDuplicateInputSchema = EventTypeDuplicateInput.superRefine(refuseReservedEventTypeSlug);

export type TDuplicateInputSchema = z.infer<typeof ZDuplicateInputSchema>;
