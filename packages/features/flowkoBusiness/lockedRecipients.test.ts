// Flowko U25: the addresses of Cal-locked users (primary and secondary e-mails), which BaseEmail.deliver drops
// (P6). Global client (Ruling 3: its own file, prismaMock). A failed lookup rejects: the mail is not sent
// (Ruling 12, fail closed).
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { describe, expect, it } from "vitest";
import { FlowkoRecipientLookupError, lockedRecipientAddresses } from "./lockedRecipients";

describe("lockedRecipientAddresses", () => {
  it("returns a locked user's primary and secondary e-mail, lower-cased", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ email: "Ana@Example.com" }] as never);
    prismaMock.secondaryEmail.findMany.mockResolvedValue([{ email: "ANA.ALT@example.com" }] as never);

    const locked = await lockedRecipientAddresses([
      "ana@example.com",
      "ana.alt@example.com",
      "stranka@example.com",
    ]);

    expect(locked).toEqual(new Set(["ana@example.com", "ana.alt@example.com"]));
    const userQuery = prismaMock.user.findMany.mock.calls[0][0] as { where: unknown; select: unknown };
    expect(userQuery.where).toEqual({
      locked: true,
      email: { in: ["ana@example.com", "ana.alt@example.com", "stranka@example.com"], mode: "insensitive" },
    });
    expect(userQuery.select).toEqual({ email: true });
    const secondaryQuery = prismaMock.secondaryEmail.findMany.mock.calls[0][0] as {
      where: unknown;
      select: unknown;
    };
    expect(secondaryQuery.where).toEqual({
      email: { in: ["ana@example.com", "ana.alt@example.com", "stranka@example.com"], mode: "insensitive" },
      user: { locked: true },
    });
    expect(secondaryQuery.select).toEqual({ email: true });
  });

  it("asks each distinct address once", async () => {
    prismaMock.user.findMany.mockResolvedValue([] as never);
    prismaMock.secondaryEmail.findMany.mockResolvedValue([] as never);

    await expect(lockedRecipientAddresses(["a@example.com", "a@example.com", ""])).resolves.toEqual(
      new Set()
    );
    const userQuery = prismaMock.user.findMany.mock.calls[0][0] as { where: { email: { in: string[] } } };
    expect(userQuery.where.email.in).toEqual(["a@example.com"]);
  });

  it("no address: no query", async () => {
    await expect(lockedRecipientAddresses([])).resolves.toEqual(new Set());
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.secondaryEmail.findMany).not.toHaveBeenCalled();
  });

  it("a rejected query rejects with an error that names no address", async () => {
    prismaMock.user.findMany.mockRejectedValue(
      Object.assign(new Error("query failed for ana@example.com"), { code: "P1001" })
    );
    prismaMock.secondaryEmail.findMany.mockResolvedValue([] as never);

    const error = await lockedRecipientAddresses(["ana@example.com"]).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(FlowkoRecipientLookupError);
    expect(error).toMatchObject({ code: "P1001" });
    expect(JSON.stringify(error)).not.toContain("ana@example.com");
    expect(String(error)).not.toContain("ana@example.com");
    expect((error as Error).cause).toBeUndefined();
  });

  it("a rejected secondary-address query rejects too", async () => {
    prismaMock.user.findMany.mockResolvedValue([] as never);
    prismaMock.secondaryEmail.findMany.mockRejectedValue(new Error("db down"));

    await expect(lockedRecipientAddresses(["ana@example.com"])).rejects.toBeInstanceOf(
      FlowkoRecipientLookupError
    );
  });
});
