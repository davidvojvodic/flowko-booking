// Flowko U25: the session-refresh guard (P4). A token whose user is gone or Cal-locked (the excludeLockedUsers
// extension adds locked=false to the lookup) ends the session; a malformed sub ends it without a query.
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { describe, expect, it } from "vitest";
import { assertSessionUserActive, FlowkoSessionEndedError } from "./sessionGuard";

describe("assertSessionUserActive", () => {
  it("resolves when the user is found by id", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 } as never);

    await expect(assertSessionUserActive({ sub: "7" })).resolves.toBeUndefined();
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 7 }, select: { id: true } });
  });

  it("throws FlowkoSessionEndedError when no (unlocked) user has the id", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const error = await assertSessionUserActive({ sub: "7" }).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(FlowkoSessionEndedError);
    expect((error as Error).message).not.toContain("7");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["not a number", "abc"],
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "1.5"],
  ])("throws without a query for a %s sub", async (_label, sub) => {
    await expect(assertSessionUserActive({ sub })).rejects.toBeInstanceOf(FlowkoSessionEndedError);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});
