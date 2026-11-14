// Flowko U29a: strict input shapes of viewer.flowko.services.* (S14). Shapes, ids (int 1..2147483647) and generous
// size caps only: the editor rules (name, category, step rules and caps, who does it) live in serviceInputSchema,
// which services.ts applies, so a refused value answers its code (bad_service, bad_member, service_name_taken)
// rather than a zod message. No online flag, grid or position key: a save never writes them. Flowko U29e: E8, R15 —
// priceCents is a required key (a finite number or null = no price); its rules (integer 0..9.999,99 €) are
// serviceInputSchema's (bad_service). The actor is always ctx.user.id.
import { z } from "zod";

const MAX_INT4 = 2147483647;
const idSchema = z.number().int().positive().max(MAX_INT4);
/** Early 400 for an oversized payload; generous so an untrimmed value still reaches the service's rule. */
const TEXT_MAX = 500;
const STEPS_MAX = 50;
const WORKERS_MAX = 200;
const SERVICES_MAX = 500;

const stepSchema = z
  .object({ kind: z.enum(["busy", "processing"]), minutes: z.number().finite() })
  .strict();

export const ZSaveServiceInput = z
  .object({
    id: idSchema.optional(),
    name: z.string().max(TEXT_MAX),
    category: z.string().max(TEXT_MAX).nullable(),
    steps: z.array(stepSchema).max(STEPS_MAX),
    workerMemberIds: z.array(idSchema).max(WORKERS_MAX),
    priceCents: z.number().finite().nullable(), // Flowko U29e: E8
  })
  .strict();
export type TSaveServiceInput = z.infer<typeof ZSaveServiceInput>;

export const ZRemoveServiceInput = z.object({ serviceId: idSchema }).strict();
export type TRemoveServiceInput = z.infer<typeof ZRemoveServiceInput>;

export const ZReorderServicesInput = z.object({ serviceIds: z.array(idSchema).max(SERVICES_MAX) }).strict();
export type TReorderServicesInput = z.infer<typeof ZReorderServicesInput>;
