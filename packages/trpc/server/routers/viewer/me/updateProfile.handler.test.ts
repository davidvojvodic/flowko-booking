import { beforeEach, describe, expect, it, vi } from "vitest";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("@calcom/prisma", () => ({ prisma: { user: { update } } }));
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
