import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({
  default: { user: { findFirst: mocks.findFirst }, team: { findUnique: mocks.findUnique } },
  prisma: { user: { findFirst: mocks.findFirst }, team: { findUnique: mocks.findUnique } },
}));

import {
  validateAndGetCorrectedUsernameAndEmail,
  validateAndGetCorrectedUsernameInTeam,
} from "./validateUsername";

// Flowko (U13 hardening): signup refuses reserved usernames (reservedUsernames.ts).
describe("validateAndGetCorrectedUsernameAndEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
  });

  it.each([
    "embed",
    "settings",
    "booking",
    "sl",
    "studio-embed",
    "Apps",
  ])("refuses %j before any lookup", async (username) => {
    await expect(
      validateAndGetCorrectedUsernameAndEmail({ username, email: "host@example.com", isSignup: true })
    ).resolves.toEqual({ isValid: false, username: undefined, email: "host@example.com" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("accepts a free, unreserved name", async () => {
    await expect(
      validateAndGetCorrectedUsernameAndEmail({
        username: "flowko-test",
        email: "host@example.com",
        isSignup: true,
      })
    ).resolves.toEqual({ isValid: true, username: "flowko-test", email: undefined });
  });

  it("refuses a reserved name derived from the e-mail in an organization", async () => {
    await expect(
      validateAndGetCorrectedUsernameAndEmail({
        username: "anything",
        email: "support@example.com",
        organizationId: 7,
        orgAutoAcceptEmail: "example.com",
        isSignup: true,
      })
    ).resolves.toEqual({ isValid: false, username: undefined, email: "support@example.com" });
  });

  it("refuses a reserved name for a team invite outside an organization", async () => {
    mocks.findUnique.mockResolvedValue({
      metadata: null,
      isOrganization: false,
      parentId: null,
      organizationSettings: null,
      parent: null,
    });
    await expect(
      validateAndGetCorrectedUsernameInTeam("embed", "host@example.com", 3, true)
    ).resolves.toEqual({
      isValid: false,
      username: undefined,
      email: "host@example.com",
    });
  });
});
