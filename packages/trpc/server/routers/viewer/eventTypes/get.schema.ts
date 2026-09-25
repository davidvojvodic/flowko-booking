import { z } from "zod";

export type TGetInputSchema = {
  id: number;
};

export const ZGetInputSchema: z.ZodType<TGetInputSchema> = z
  .object({
    id: z.number(),
  })
  // Flowko: every caller sends only id, so a second id key such as eventTypeId is refused
  .strict();
