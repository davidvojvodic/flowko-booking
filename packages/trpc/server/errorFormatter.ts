import { z } from "zod";

import type { TRPCError } from "@trpc/server";

import { translateErrorMessage } from "./translateErrorMessage";

type ErrorShape = {
  message: string;
  code: number;
  data: {
    code: string;
    httpStatus: number;
    path?: string;
    [key: string]: unknown;
  };
};

type ErrorFormatterOptions = {
  shape: ErrorShape;
  error: TRPCError;
  type: "query" | "mutation" | "subscription" | "unknown";
  path: string | undefined;
  input: unknown;
  ctx: unknown;
};

export function errorFormatter({ shape, error, ctx }: ErrorFormatterOptions): ErrorShape {
  // Flowko: ctx.locale is the caller's UI language (undefined when the context could not be created)
  const locale = (ctx as { locale?: string } | undefined | null)?.locale;
  if (error.cause instanceof z.ZodError) {
    return {
      message: translateErrorMessage("invalid_input", locale),
      code: 400,
      data: {
        code: "BAD_REQUEST",
        httpStatus: 400,
        path: shape.data.path,
        zodError: error.cause.flatten(),
      },
    };
  }
  const message = translateErrorMessage(shape.message, locale);
  return message === shape.message ? shape : { ...shape, message };
}
