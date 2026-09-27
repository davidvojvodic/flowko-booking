import type { z } from "zod";

import { createEventTypeInput } from "@calcom/features/eventtypes/lib/schemas";

import { refuseReservedEventTypeSlug } from "./reservedSlug";

// Flowko (U13 hardening): no slug that collides with the embed route or a rewrite (see ./reservedSlug).
export const ZCreateInputSchema = createEventTypeInput.superRefine(refuseReservedEventTypeSlug);

export type TCreateInputSchema = z.infer<typeof ZCreateInputSchema>;
