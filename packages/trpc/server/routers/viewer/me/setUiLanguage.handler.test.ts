import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update } = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));

vi.mock("@calcom/prisma", () => ({ prisma: { user: { findUnique, update } } }));

import { setUiLanguageHandler } from "./setUiLanguage.handler";
import { ZSetUiLanguageInputSchema } from "./setUiLanguage.schema";

const ctx = { user: { id: 7, locale: "sl", timeZone: "Europe/Ljubljana" } } as never;

describe("viewer.me.setUiLanguage (Flowko U14)", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    update.mockResolvedValue({ id: 7 });
  });

  it("writes metadata.uiLanguage and keeps every other key, known to the schema or not", async () => {
    findUnique.mockResolvedValue({ metadata: { stripeCustomerId: "cus_1", notInTheSchema: true } });

    await expect(setUiLanguageHandler({ ctx, input: { language: "en" } })).resolves.toEqual({ locale: "en" });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 7 }, select: { metadata: true } });
    expect(update.mock.calls[0][0].where).toEqual({ id: 7 });
    expect(update.mock.calls[0][0].data.metadata).toEqual({
      stripeCustomerId: "cus_1",
      notInTheSchema: true,
      uiLanguage: "en",
    });
  });

  it("writes nothing but metadata: never locale, so booking pages and e-mails stay put, nor timeZone", async () => {
    findUnique.mockResolvedValue({ metadata: null });

    await setUiLanguageHandler({ ctx, input: { language: "sl" } });

    expect(Object.keys(update.mock.calls[0][0].data)).toEqual(["metadata"]);
    expect(update.mock.calls[0][0].data.metadata).toEqual({ uiLanguage: "sl" });
  });

  it.each(["de", "", "SL", "../x", null, undefined, ["en"]])("refuses %j", (language) => {
    expect(ZSetUiLanguageInputSchema.safeParse({ language }).success).toBe(false);
  });

  it.each(["sl", "en"])("accepts %s", (language) => {
    expect(ZSetUiLanguageInputSchema.safeParse({ language }).success).toBe(true);
  });
});
