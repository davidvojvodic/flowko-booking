// Flowko U25: business slugs and usernames share one name space.
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { beforeEach, describe, expect, it } from "vitest";
import { businessSlugProblem, usernameClashesWithBusiness } from "./nameSpace";

describe("businessSlugProblem", () => {
  beforeEach(() => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.flowkoBusiness.findFirst.mockResolvedValue(null);
  });

  it.each(["Studio", "ana.bar", "a", "łuka"])("answers %j as invalid without a lookup", async (slug) => {
    await expect(businessSlugProblem(prismaMock, slug)).resolves.toBe("invalid");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.flowkoBusiness.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    "settings",
    "sl",
    "myembed",
    "auth",
    "api",
    "bookings",
  ])("answers %j as reserved without a lookup", async (slug) => {
    await expect(businessSlugProblem(prismaMock, slug)).resolves.toBe("reserved");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.flowkoBusiness.findFirst).not.toHaveBeenCalled();
  });

  it("answers user when a user (any case, locked included) has the name", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 7 } as never);

    await expect(businessSlugProblem(prismaMock, "studio")).resolves.toBe("user");
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
    const { where } = prismaMock.user.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(where.username).toEqual({ equals: "studio", mode: "insensitive" });
    // The excludeLockedUsers extension adds locked=false unless the where mentions "locked":
    expect(where.OR).toEqual([{ locked: false }, { locked: true }]);
    expect(prismaMock.flowkoBusiness.findFirst).not.toHaveBeenCalled();
  });

  it("answers business when another business has the slug", async () => {
    prismaMock.flowkoBusiness.findFirst.mockResolvedValue({ id: 3 } as never);

    await expect(businessSlugProblem(prismaMock, "studio")).resolves.toBe("business");
    expect(prismaMock.flowkoBusiness.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "studio" } })
    );
  });

  it("leaves the business itself out when exceptBusinessId is given", async () => {
    await expect(businessSlugProblem(prismaMock, "studio", 3)).resolves.toBeNull();
    expect(prismaMock.flowkoBusiness.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "studio", id: { not: 3 } } })
    );
  });

  it("answers null for a free slug", async () => {
    await expect(businessSlugProblem(prismaMock, "flowko-test-business")).resolves.toBeNull();
  });
});

describe("usernameClashesWithBusiness", () => {
  beforeEach(() => {
    prismaMock.flowkoBusiness.findFirst.mockResolvedValue(null);
  });

  it("looks the username up as a lowercase slug", async () => {
    prismaMock.flowkoBusiness.findFirst.mockResolvedValue({ id: 3 } as never);

    await expect(usernameClashesWithBusiness(prismaMock, " Studio ")).resolves.toBe(true);
    expect(prismaMock.flowkoBusiness.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "studio" } })
    );
  });

  it("answers false when no business has the name", async () => {
    await expect(usernameClashesWithBusiness(prismaMock, "Studio")).resolves.toBe(false);
  });

  it.each([null, undefined, "", "   "])("answers false for %j without a lookup", async (username) => {
    await expect(usernameClashesWithBusiness(prismaMock, username)).resolves.toBe(false);
    expect(prismaMock.flowkoBusiness.findFirst).not.toHaveBeenCalled();
  });
});
