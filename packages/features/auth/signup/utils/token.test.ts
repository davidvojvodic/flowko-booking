import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ validateInTeam: vi.fn() }));

vi.mock("@calcom/prisma", () => ({ prisma: {}, default: {} }));
vi.mock("@calcom/features/auth/signup/utils/validateUsername", () => ({
  validateAndGetCorrectedUsernameInTeam: mocks.validateInTeam,
}));

import { HttpError } from "@calcom/lib/http-error";
import { validateAndGetCorrectedUsernameForTeam } from "./token";

// Flowko (U13 hardening): a signup token without a team skips the team validation, so the reserved names
// are refused before it.
describe("validateAndGetCorrectedUsernameForTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateInTeam.mockResolvedValue({ isValid: true, username: "flowko-test", email: undefined });
  });

  it.each([null, 3])("refuses a reserved name with teamId %j", async (teamId) => {
    const result = validateAndGetCorrectedUsernameForTeam({
      username: "embed",
      email: "host@example.com",
      teamId,
      isSignup: true,
    });
    await expect(result).rejects.toBeInstanceOf(HttpError);
    await expect(result).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.validateInTeam).not.toHaveBeenCalled();
  });

  it("keeps an unreserved name without a team", async () => {
    await expect(
      validateAndGetCorrectedUsernameForTeam({
        username: "flowko-test",
        email: "host@example.com",
        teamId: null,
        isSignup: true,
      })
    ).resolves.toBe("flowko-test");
  });

  it("still validates an unreserved name in the team", async () => {
    await expect(
      validateAndGetCorrectedUsernameForTeam({
        username: "flowko-test",
        email: "host@example.com",
        teamId: 3,
        isSignup: true,
      })
    ).resolves.toBe("flowko-test");
    expect(mocks.validateInTeam).toHaveBeenCalledWith("flowko-test", "host@example.com", 3, true);
  });
});
