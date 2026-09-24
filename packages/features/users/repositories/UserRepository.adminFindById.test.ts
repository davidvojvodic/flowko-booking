import prismock from "@calcom/testing/lib/__mocks__/prisma";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { describe, expect, test, vi } from "vitest";

vi.mock("@calcom/app-store/delegationCredential", () => ({
  enrichHostsWithDelegationCredentials: vi.fn(),
  getUsersCredentialsIncludeServiceAccountKey: vi.fn(),
  getCredentialForSelectedCalendar: vi.fn(),
}));

// Flowko: the admin user edit page serializes this row to the client
describe("UserRepository.adminFindById", () => {
  test("returns only the fields the admin edit form reads, never 2FA secrets or metadata", async () => {
    const created = await prismock.user.create({
      data: {
        username: "salon-ana",
        email: "ana@example.com",
        name: "Ana",
        twoFactorEnabled: true,
        twoFactorSecret: "encrypted-2fa-secret",
        backupCodes: "encrypted-backup-codes",
        metadata: { apiSecret: "do-not-leak" },
        identityProviderId: "google-sub-123",
      },
    });

    const user = await new UserRepository(prismock).adminFindById(created.id);

    expect(Object.keys(user).sort()).toEqual(
      [
        "allowDynamicBooking",
        "avatarUrl",
        "bio",
        "createdDate",
        "defaultScheduleId",
        "email",
        "id",
        "identityProvider",
        "locale",
        "name",
        "role",
        "theme",
        "timeFormat",
        "timeZone",
        "username",
        "weekStart",
      ].sort()
    );
    expect(user).toMatchObject({ id: created.id, username: "salon-ana", email: "ana@example.com", name: "Ana" });
    expect(JSON.stringify(user)).not.toMatch(/encrypted-2fa-secret|encrypted-backup-codes|do-not-leak|google-sub-123/);
  });

  test("still throws for a user that does not exist", async () => {
    await expect(new UserRepository(prismock).adminFindById(987654)).rejects.toThrow();
  });
});
