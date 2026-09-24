import { z } from "zod";

export type TDeleteInputSchema = {
  id: number;
};

export const ZDeleteInputSchema: z.ZodType<TDeleteInputSchema> = z
  .object({
    id: z.number(),
  })
  // Flowko: every caller sends only id, so a second id key such as eventTypeId is refused
  .strict();
