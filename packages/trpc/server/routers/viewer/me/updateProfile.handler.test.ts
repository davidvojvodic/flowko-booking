import { beforeEach, describe, expect, it, vi } from "vitest";

const { update, secondaryEmailWrites } = vi.hoisted(() => ({
  update: vi.fn(),
  secondaryEmailWrites: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({
  prisma: {
    user: { update },
    // Flowko U27: any secondary e-mail write counts (E4 asserts none happens)
    secondaryEmail: {
      findUnique: secondaryEmailWrites,
      findMany: secondaryEmailWrites,
      update: secondaryEmailWrites,
      deleteMany: secondaryEmailWrites,
    },
    $transaction: secondaryEmailWrites,
  },
}));
vi.mock("@calcom/app-store/stripepayment/lib/utils", () => ({ getPremiumMonthlyPlanPriceId: vi.fn() }));
vi.mock("@calcom/features/auth/lib/verifyEmail", () => ({ sendChangeOfEmailVerification: vi.fn() }));
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: vi.fn().mockImplementation(function () {
    return { checkIfFeatureIsEnabledGlobally: vi.fn().mockResolvedValue(false) };
  }),
}));
vi.mock("@calcom/features/profile/lib/checkUsername", () => ({ checkUsername: vi.fn() }));
vi.mock("@calcom/features/schedules/repositories/ScheduleRepository", () => ({ ScheduleRepository: vi.fn() }));
vi.mock("@calcom/lib/server/avatar", () => ({ uploadAvatar: vi.fn() }));
vi.mock("@calcom/lib/server/resizeBase64Image", () => ({ resizeBase64Image: vi.fn() }));
vi.mock("@calcom/i18n/server", () => ({ getTranslation: vi.fn() }));

import { updateProfileHandler } from "./updateProfile.handler";

const ctx = (metadata: Record<string, unknown>) =>
  ({ user: { id: 7, locale: "sl", timeZone: "Europe/Ljubljana", metadata } }) as never;

const writtenMetadata = () => update.mock.calls[0][0].data.metadata;

// Flowko U14: Settings → Jezik is the language of the whole account, so saving it clears the SL / EN switch's choice.
describe("updateProfile and the SL / EN choice (Flowko U14)", () => {
  beforeEach(() => {
    update.mockReset();
    update.mockResolvedValue({ id: 7, schedules: [], avatarUrl: null });
  });

  it("removes uiLanguage when the language is saved, and keeps the other keys", async () => {
    await updateProfileHandler({
      ctx: ctx({ uiLanguage: "en", stripeCustomerId: "cus_1" }),
      input: { locale: "sl" },
    });

    expect(writtenMetadata()).toEqual({ stripeCustomerId: "cus_1" });
    expect(update.mock.calls[0][0].data.locale).toBe("sl");
  });

  it("keeps uiLanguage when something else is saved", async () => {
    await updateProfileHandler({ ctx: ctx({ uiLanguage: "en" }), input: { name: "Ana" } });

    expect(writtenMetadata()).toEqual({ uiLanguage: "en" });
  });

  it("doesn't let the profile form set uiLanguage", async () => {
    await updateProfileHandler({
      ctx: ctx({}),
      input: { name: "Ana", metadata: { uiLanguage: "en" } as never },
    });

    expect(writtenMetadata()).toEqual({});
  });
});

// Flowko U27 (E4): the desk placeholder domain is never a profile e-mail, primary or secondary, and a desk-only
// user's address is never changed to a real one.
describe("updateProfile and the desk placeholder domain (Flowko U27 E4)", () => {
  beforeEach(() => {
    update.mockReset();
    secondaryEmailWrites.mockReset();
    update.mockResolvedValue({ id: 7, email: "ana@example.com", schedules: [], avatarUrl: null });
  });

  const ctxWithEmail = (email: string) =>
    ({ user: { id: 7, email, locale: "sl", timeZone: "Europe/Ljubljana", metadata: {} } }) as never;

  it("refuses a primary e-mail on @flowko.invalid and writes nothing", async () => {
    await expect(
      updateProfileHandler({ ctx: ctxWithEmail("ana@example.com"), input: { email: "x@flowko.invalid" } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "invalid_email_address" });
    expect(update).not.toHaveBeenCalled();
    expect(secondaryEmailWrites).not.toHaveBeenCalled();
  });

  it("refuses a secondary e-mail on @flowko.invalid (any case) and writes nothing", async () => {
    await expect(
      updateProfileHandler({
        ctx: ctxWithEmail("ana@example.com"),
        input: { secondaryEmails: [{ id: 1, email: "Desk@FLOWKO.INVALID" }] },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "invalid_email_address" });
    expect(update).not.toHaveBeenCalled();
    expect(secondaryEmailWrites).not.toHaveBeenCalled();
  });

  it("refuses changing a desk-only user's address to a real one and writes nothing", async () => {
    await expect(
      updateProfileHandler({
        ctx: ctxWithEmail("desk-1@flowko.invalid"),
        input: { email: "ana@example.com" },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "invalid_email_address" });
    expect(update).not.toHaveBeenCalled();
  });

  it("an ordinary e-mail change and an unchanged address still save", async () => {
    await updateProfileHandler({ ctx: ctxWithEmail("ana@example.com"), input: { email: "ana2@example.com" } });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.email).toBe("ana2@example.com");

    update.mockClear();
    await updateProfileHandler({ ctx: ctxWithEmail("desk-1@flowko.invalid"), input: { email: "desk-1@flowko.invalid", name: "Ana" } });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
