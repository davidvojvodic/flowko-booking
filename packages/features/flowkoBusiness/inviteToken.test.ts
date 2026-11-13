// Flowko U29d: the invite token (I2): 32 random bytes as base64url (43 characters), stored only as the sha256 hex
// of the token; the shape check the accept page and route run before any lookup.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashInviteToken, isInviteTokenShape, newInviteToken } from "./inviteToken";

describe("newInviteToken", () => {
  it("is 43 base64url characters and its hash is the sha256 hex of the token", () => {
    const { token, tokenHash } = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(tokenHash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
  });

  it("never repeats over 1 000 calls", () => {
    const tokens = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const { token, tokenHash } = newInviteToken();
      tokens.add(token);
      hashes.add(tokenHash);
    }
    expect(tokens.size).toBe(1000);
    expect(hashes.size).toBe(1000);
  });
});

describe("hashInviteToken", () => {
  it("is the lower-case sha256 hex of the UTF-8 token and matches the hash newInviteToken stored", () => {
    const { token, tokenHash } = newInviteToken();
    expect(hashInviteToken(token)).toBe(tokenHash);
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("isInviteTokenShape", () => {
  const good = "A".repeat(42) + "w";
  it("accepts exactly 43 base64url characters", () => {
    expect(isInviteTokenShape(good)).toBe(true);
    expect(isInviteTokenShape(newInviteToken().token)).toBe(true);
    expect(isInviteTokenShape("aZ09_-".repeat(7) + "x")).toBe(true);
  });

  it("refuses 42 and 44 characters, +, / and =, and anything that is not a string", () => {
    expect(isInviteTokenShape("A".repeat(42))).toBe(false);
    expect(isInviteTokenShape("A".repeat(44))).toBe(false);
    expect(isInviteTokenShape(`${"A".repeat(42)}+`)).toBe(false);
    expect(isInviteTokenShape(`${"A".repeat(42)}/`)).toBe(false);
    expect(isInviteTokenShape(`${"A".repeat(42)}=`)).toBe(false);
    expect(isInviteTokenShape(`${"A".repeat(41)} A`)).toBe(false);
    expect(isInviteTokenShape(`${"A".repeat(42)}\n`)).toBe(false);
    expect(isInviteTokenShape("")).toBe(false);
    expect(isInviteTokenShape(undefined)).toBe(false);
    expect(isInviteTokenShape(42)).toBe(false);
  });
});
