import { afterEach, describe, expect, it, vi } from "vitest";

import { isActiveInstanceAdmin } from "./isActiveInstanceAdmin";

const admin = { role: "ADMIN", twoFactorEnabled: true, identityProvider: "CAL" };

describe("isActiveInstanceAdmin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts an admin with two-factor authentication on", () => {
    expect(isActiveInstanceAdmin(admin)).toBe(true);
  });

  // validateRole makes such an admin an INACTIVE_ADMIN at sign-in, but the database still says ADMIN
  it("refuses an admin with two-factor authentication off", () => {
    expect(isActiveInstanceAdmin({ ...admin, twoFactorEnabled: false })).toBe(false);
  });

  it("refuses a user who isn't an admin, and anyone without a user", () => {
    expect(isActiveInstanceAdmin({ ...admin, role: "USER" })).toBe(false);
    expect(isActiveInstanceAdmin({ ...admin, role: "INACTIVE_ADMIN" })).toBe(false);
    expect(isActiveInstanceAdmin(null)).toBe(false);
    expect(isActiveInstanceAdmin(undefined)).toBe(false);
  });

  it("treats missing fields as 2FA off and identity provider CAL", () => {
    expect(isActiveInstanceAdmin({ role: "ADMIN" })).toBe(false);
    expect(isActiveInstanceAdmin({ role: "ADMIN", identityProvider: null, twoFactorEnabled: null })).toBe(false);
  });

  it("exempts an admin who signs in with another identity provider, as validateRole does", () => {
    expect(isActiveInstanceAdmin({ ...admin, twoFactorEnabled: false, identityProvider: "GOOGLE" })).toBe(true);
    expect(isActiveInstanceAdmin({ ...admin, twoFactorEnabled: false, identityProvider: "SAML" })).toBe(true);
  });

  it("exempts an E2E environment, as validateRole does", () => {
    vi.stubEnv("NEXT_PUBLIC_IS_E2E", "1");

    expect(isActiveInstanceAdmin({ ...admin, twoFactorEnabled: false })).toBe(true);
  });

  // The strong-password check happens only at sign-in, so its verdict is the session's JWT role
  it("refuses an admin whose session signed in as INACTIVE_ADMIN", () => {
    expect(isActiveInstanceAdmin(admin, "ADMIN")).toBe(true);
    expect(isActiveInstanceAdmin(admin, "INACTIVE_ADMIN")).toBe(false);
    expect(isActiveInstanceAdmin(admin, null)).toBe(false);
    expect(isActiveInstanceAdmin({ ...admin, twoFactorEnabled: false }, "ADMIN")).toBe(false);
  });

  it("refuses a user who was an admin at sign-in but no longer is", () => {
    expect(isActiveInstanceAdmin({ ...admin, role: "USER" }, "ADMIN")).toBe(false);
  });
});
