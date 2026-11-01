import { describe, expect, it } from "vitest";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { errorFormatter } from "./errorFormatter";
import { translateErrorMessage } from "./translateErrorMessage";

describe("translateErrorMessage (Flowko U14)", () => {
  it("says a listed key in the caller's language", () => {
    expect(translateErrorMessage("booking_already_confirmed", "sl")).toBe("Ta rezervacija je že potrjena.");
    expect(translateErrorMessage("booking_already_confirmed", "en")).toBe("This booking is already confirmed");
  });

  it("gives English to any other language and when there is no language", () => {
    expect(translateErrorMessage("booking_already_confirmed", "de")).toBe("This booking is already confirmed");
    expect(translateErrorMessage("booking_already_confirmed", undefined)).toBe(
      "This booking is already confirmed"
    );
  });

  it("turns a bare code into a sentence", () => {
    expect(translateErrorMessage("FORBIDDEN", "sl")).toBe("Za to dejanje nimate dovoljenja.");
    expect(translateErrorMessage("NOT_FOUND", "sl")).toBe("Ni najdeno.");
    expect(translateErrorMessage("UNAUTHORIZED", "sl")).toBe("Nepooblaščen dostop");
    expect(translateErrorMessage("BAD_REQUEST", "en")).toBe(translateErrorMessage("invalid_input", "en"));
    expect(translateErrorMessage("BAD_REQUEST", "sl")).not.toBe("BAD_REQUEST");
  });

  it("leaves keys the client compares itself, and sentences, unchanged", () => {
    expect(translateErrorMessage("invalid_code", "sl")).toBe("invalid_code");
    expect(translateErrorMessage("reason_id_required", "sl")).toBe("reason_id_required");
    expect(translateErrorMessage("Rate limit exceeded. Try again in 5 seconds.", "sl")).toBe(
      "Rate limit exceeded. Try again in 5 seconds."
    );
  });

  it("errorFormatter says Zod failures and keys in the context's language", () => {
    const shape = { message: "x", code: 500, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: "p" } };
    const zodError = new z.ZodError([{ path: ["a"], message: "Required", code: "custom" }]);
    const base = { type: "query" as const, path: "p", input: undefined };

    const zod = errorFormatter({
      ...base,
      shape,
      error: new TRPCError({ code: "BAD_REQUEST", cause: zodError }),
      ctx: { locale: "sl" },
    });
    expect(zod.message).toBe("Neveljaven vnos");

    const key = errorFormatter({
      ...base,
      shape: { ...shape, message: "no_show_before_start_error" },
      error: new TRPCError({ code: "BAD_REQUEST", message: "no_show_before_start_error" }),
      ctx: { locale: "sl" },
    });
    expect(key.message).toBe("Neudeležbe ni mogoče označiti, preden se sestanek začne.");

    const noCtx = errorFormatter({ ...base, shape, error: new TRPCError({ code: "BAD_REQUEST", cause: zodError }), ctx: undefined });
    expect(noCtx.message).toBe("Invalid input");
  });
});
