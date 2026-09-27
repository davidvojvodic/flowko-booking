import type { z } from "zod";

import type { TUpdateInputSchema as TBaseUpdateInputSchema } from "../types";
import { ZUpdateInputSchema as BaseUpdateInputSchema } from "../types";
import { refuseReservedEventTypeSlug } from "./reservedSlug";

// Flowko (U13 hardening): no slug that collides with the embed route or a rewrite (see ./reservedSlug).
// Leaving the slug out, as most partial updates do, is unaffected.
export const ZUpdateInputSchema: z.ZodType<TBaseUpdateInputSchema> =
  BaseUpdateInputSchema.superRefine(refuseReservedEventTypeSlug);

export type TUpdateInputSchema = TBaseUpdateInputSchema;
