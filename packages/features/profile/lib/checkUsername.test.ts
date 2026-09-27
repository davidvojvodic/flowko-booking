import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRegularUsername: vi.fn(),
  usernameCheck: vi.fn(),
}));

vi.mock("./checkRegularUsername", () => ({ checkRegularUsername: mocks.checkRegularUsername }));
vi.mock("@calcom/lib/server/username", () => ({ usernameCheck: mocks.usernameCheck }));

import { RESERVED_USERNAME_MESSAGE } from "@calcom/features/auth/signup/utils/reservedUsernames";
import { checkUsername } from "./checkUsername";

// Flowko (U13 hardening): the check behind the username field (/api/username) and viewer.me.updateProfile.
describe("checkUsername refuses reserved names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRegularUsername.mockResolvedValue({ available: true, premium: false });
    mocks.usernameCheck.mockResolvedValue({ available: true, premium: false, suggestedUsername: "" });
  });

  it.each([
    "embed",
    "Embed",
    "settings",
    "Settings ",
    "event types",
    "sl",
    "PT-BR",
    "studio-embed",
    "booking",
  ])("answers %j as unavailable without a lookup", async (username) => {
    await expect(checkUsername(username)).resolves.toEqual({
      available: false,
      premium: false,
      message: RESERVED_USERNAME_MESSAGE,
    });
    expect(mocks.checkRegularUsername).not.toHaveBeenCalled();
    expect(mocks.usernameCheck).not.toHaveBeenCalled();
  });

  it("leaves any other name to the regular check", async () => {
    await expect(checkUsername("flowko-test")).resolves.toEqual({ available: true, premium: false });
    expect(mocks.checkRegularUsername).toHaveBeenCalledWith("flowko-test", undefined);
  });

  it("passes the organization domain through", async () => {
    await checkUsername("embedded", "acme");
    expect(mocks.checkRegularUsername).toHaveBeenCalledWith("embedded", "acme");
  });
});
