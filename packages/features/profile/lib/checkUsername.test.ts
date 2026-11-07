import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
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
    prismaMock.flowkoBusiness.findFirst.mockResolvedValue(null);
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

// Flowko U25: a business slug and a username share one name space, so a business's slug is never available.
describe("checkUsername refuses a business's slug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRegularUsername.mockResolvedValue({ available: true, premium: false });
    prismaMock.flowkoBusiness.findFirst.mockResolvedValue(null);
  });

  it("answers a name a business holds as unavailable, in any case", async () => {
    prismaMock.flowkoBusiness.findFirst.mockResolvedValue({ id: 3 } as never);

    await expect(checkUsername("Studio")).resolves.toEqual({
      available: false,
      premium: false,
      message: RESERVED_USERNAME_MESSAGE,
    });
    expect(prismaMock.flowkoBusiness.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "studio" } })
    );
    expect(mocks.checkRegularUsername).not.toHaveBeenCalled();
  });

  it("leaves the result unchanged when no business holds the name", async () => {
    await expect(checkUsername("Studio")).resolves.toEqual({ available: true, premium: false });
    expect(mocks.checkRegularUsername).toHaveBeenCalledWith("Studio", undefined);
  });
});
