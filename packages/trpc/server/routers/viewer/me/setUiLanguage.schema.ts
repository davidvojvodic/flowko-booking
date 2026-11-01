import { z } from "zod";

export const ZSetUiLanguageInputSchema = z.object({
  language: z.enum(["sl", "en"]),
});

export type TSetUiLanguageInputSchema = z.infer<typeof ZSetUiLanguageInputSchema>;
