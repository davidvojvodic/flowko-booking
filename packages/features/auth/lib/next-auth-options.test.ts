import { createInMemoryRateLimiter } from "@calcom/lib/rateLimit";
import { safeStringify } from "@calcom/lib/safeStringify";
import { hashEmail, piiHasher } from "@calcom/lib/server/PiiHasher";
import { IdentityProvider, UserPermissionRole } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "./ErrorCode";

// Mock dependencies
vi.mock("@calcom/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
  default: {
    user: {
      update: vi.fn(),
    },
  },
}));

const mockFindByEmailAndIncludeProfilesAndPassword = vi.fn();
const mockFindByEmail = vi.fn();

vi.mock("@calcom/features/users/repositories/UserRepository", () => {
  return {
    UserRepository: vi.fn().mockImplementation(function () {
      return {
        findByEmailAndIncludeProfilesAndPassword: mockFindByEmailAndIncludeProfilesAndPassword,
        findByEmail: mockFindByEmail,
      };
    }),
  };
});

vi.mock("./verifyPassword", () => ({
  verifyPassword: vi.fn(),
}));

// Flowko: the real checkRateLimitAndThrowError and PiiHasher, driven by a real in-memory limiter with a fake
// clock (rateLimiter() itself always passes under vitest). The beforeEach below gives each test a fresh one.
const rateLimitState = vi.hoisted(() => ({
  now: 1_800_000_000_000,
  limiter: undefined as undefined | ((helper: { identifier: string }) => Promise<unknown>),
}));

vi.mock("@calcom/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/rateLimit")>();
  return { ...actual, rateLimiter: () => rateLimitState.limiter };
});

beforeEach(() => {
  rateLimitState.now = 1_800_000_000_000;
  rateLimitState.limiter = createInMemoryRateLimiter({ now: () => rateLimitState.now });
});

vi.mock("@calcom/lib/totp", () => ({
  totpAuthenticatorCheck: vi.fn(),
}));

vi.mock("@calcom/lib/crypto", () => ({
  symmetricDecrypt: vi.fn(),
  symmetricEncrypt: vi.fn(),
}));

vi.mock("@calcom/lib/auth/isPasswordValid", () => ({
  isPasswordValid: vi.fn(),
}));

vi.mock("@calcom/lib/env", () => ({
  isENVDev: false,
}));

vi.mock("@calcom/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/constants")>();
  return {
    ...actual,
    IS_TEAM_BILLING_ENABLED: false,
    ENABLE_PROFILE_SWITCHER: false,
    WEBAPP_URL: "http://localhost:3000",
  };
});

vi.mock("@calcom/lib/logger", () => ({
  default: {
    getSubLogger: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    })),
  },
}));

vi.mock("@calcom/lib/safeStringify", () => ({
  safeStringify: vi.fn((obj) => JSON.stringify(obj)),
}));

vi.mock("./next-auth-custom-adapter", () => ({
  default: vi.fn(() => ({
    linkAccount: vi.fn(),
  })),
}));

vi.mock("@calcom/i18n/server", () => ({
  getTranslation: vi.fn().mockResolvedValue((key: string) => key),
}));

vi.mock("@calcom/features/profile/repositories/ProfileRepository", () => ({
  ProfileRepository: {
    findAllProfilesForUserIncludingMovedUser: vi.fn(),
    findByUpIdWithAuth: vi.fn(),
  },
}));

// Additional mocks for signIn/JWT callback tests
const mockCredentialRepoFindFirst = vi.fn();
const mockCredentialRepoFindFirstByUserIdAndType = vi.fn();
const mockCredentialRepoCreate = vi.fn();
const mockBuildCredentialCreateData = vi.fn();
const mockUpdateProfilePhotoMicrosoft = vi.fn();
const mockUpdateProfilePhotoGoogle = vi.fn();
const mockGetIdentityProvider = vi.fn();
const mockWaitUntil = vi.fn();
const mockPrismaUserFindFirst = vi.fn();
const mockPrismaUserCreate = vi.fn();
const mockPrismaUserUpdate = vi.fn();
const mockPrismaTeamFindFirst = vi.fn();
const mockPrismaSelectedCalendarCreate = vi.fn();
const mockLinkAccount = vi.fn();

vi.mock("@calcom/features/credentials/repositories/CredentialRepository", () => ({
  CredentialRepository: {
    findFirstByAppIdAndUserId: (...args: unknown[]) => mockCredentialRepoFindFirst(...args),
    findFirstByUserIdAndType: (...args: unknown[]) => mockCredentialRepoFindFirstByUserIdAndType(...args),
    create: (...args: unknown[]) => mockCredentialRepoCreate(...args),
  },
}));

vi.mock("@calcom/features/credentials/services/CredentialDataService", () => ({
  buildCredentialCreateData: (...args: unknown[]) => mockBuildCredentialCreateData(...args),
}));

vi.mock("@calcom/app-store/_utils/oauth/updateProfilePhotoMicrosoft", () => ({
  updateProfilePhotoMicrosoft: (...args: unknown[]) => mockUpdateProfilePhotoMicrosoft(...args),
}));

vi.mock("@calcom/app-store/_utils/oauth/updateProfilePhotoGoogle", () => ({
  updateProfilePhotoGoogle: (...args: unknown[]) => mockUpdateProfilePhotoGoogle(...args),
}));

vi.mock("@calcom/features/auth/lib/identityProviders", () => ({
  getIdentityProvider: (...args: unknown[]) => mockGetIdentityProvider(...args),
}));

vi.mock("@calcom/features/auth/lib/outlook", () => ({
  OUTLOOK_CLIENT_ID: "mock-client-id",
  OUTLOOK_CLIENT_SECRET: "mock-client-secret",
  OUTLOOK_LOGIN_ENABLED: true,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (...args: unknown[]) => mockWaitUntil(...args),
}));

vi.mock("@calcom/lib/default-cookies", () => ({
  defaultCookies: vi.fn(() => ({})),
}));

vi.mock("@calcom/lib/random", () => ({
  randomString: vi.fn(() => "abc123"),
}));

vi.mock("@calcom/lib/slugify", () => ({
  default: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")),
}));

vi.mock("@calcom/app-store/googlecalendar/lib/CalendarService", () => ({
  createGoogleCalendarServiceWithGoogleType: vi.fn(),
}));

vi.mock("googleapis-common", () => ({
  OAuth2Client: vi.fn(),
}));

vi.mock("@googleapis/calendar", () => ({
  calendar_v3: {
    Calendar: vi.fn(),
  },
}));

vi.mock("next-auth/jwt", () => ({
  encode: vi.fn(),
}));

vi.mock("./signJwt", () => ({
  default: vi.fn().mockResolvedValue("mock-jwt"),
}));

vi.mock("./dub", () => ({
  dub: { track: { lead: vi.fn() } },
}));

vi.mock("../signup/utils/getOrgUsernameFromEmail", () => ({
  getOrgUsernameFromEmail: vi.fn((email: string) => email.split("@")[0]),
}));

vi.mock("next-auth/providers/azure-ad", () => ({ default: vi.fn() }));
vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn(() => ({ id: "credentials" })) }));
vi.mock("next-auth/providers/email", () => ({ default: vi.fn() }));
vi.mock("next-auth/providers/google", () => ({ default: vi.fn() }));

describe("CredentialsProvider authorize", () => {
  let authorizeCredentials: typeof import("./next-auth-options").authorizeCredentials;
  let verifyPassword: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFindByEmailAndIncludeProfilesAndPassword.mockReset();

    const verifyPasswordModule = await import("./verifyPassword");
    verifyPassword = verifyPasswordModule.verifyPassword;

    // Import the exported authorize function directly
    const authModule = await import("./next-auth-options");
    authorizeCredentials = authModule.authorizeCredentials;
  });

  const createMockUser = (overrides: Partial<any> = {}) => ({
    id: 1,
    email: "test@example.com",
    name: "Test User",
    username: "testuser",
    role: UserPermissionRole.USER,
    locked: false,
    identityProvider: IdentityProvider.CAL,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    backupCodes: null,
    password: {
      hash: "$2a$10$hashedpassword",
    },
    allProfiles: [
      {
        id: 1,
        upId: "usr_123",
        username: "testuser",
      },
    ],
    teams: [],
    ...overrides,
  });

  // Flowko: a malformed request must get the answer an unknown email gets, before any lookup, or bcrypt's own
  // "Illegal arguments" message for a missing password reveals that an account with a password exists
  describe("Flowko: malformed credentials", () => {
    const malformed = [
      ["no password", { email: "test@example.com" }],
      ["an empty password", { email: "test@example.com", password: "" }],
      ["a password array", { email: "test@example.com", password: ["a", "b"] }],
      ["an email array", { email: ["test@example.com"], password: "password123" }],
    ] as const;

    it.each(malformed)("answers %s like an unknown email, for an account with a password", async (_, credentials) => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());
      await expect(authorizeCredentials(credentials as any)).rejects.toThrow(ErrorCode.IncorrectEmailPassword);
      expect(mockFindByEmailAndIncludeProfilesAndPassword).not.toHaveBeenCalled();
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it.each(malformed)("answers %s the same way for an unknown email", async (_, credentials) => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(null);
      await expect(authorizeCredentials(credentials as any)).rejects.toThrow(ErrorCode.IncorrectEmailPassword);
    });

    it("never logs the credentials", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(null);
      await authorizeCredentials({ email: "test@example.com", password: "s3cret-password", totpCode: "654321" } as any).catch(
        () => undefined
      );
      const logged = JSON.stringify(vi.mocked(safeStringify).mock.calls);
      expect(logged).not.toContain("s3cret-password");
      expect(logged).not.toContain("654321");
    });
  });

  describe("Password validation", () => {
    it("should throw error when user has no password hash with CAL identity provider", async () => {
      const mockUser = createMockUser({
        password: null,
        identityProvider: IdentityProvider.CAL,
      });
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

      await expect(
        authorizeCredentials({
          email: "test@example.com",
          password: "password123",
        } as any)
      ).rejects.toThrow(ErrorCode.IncorrectEmailPassword);
    });

    it("should throw error when user has no password hash with Google identity provider", async () => {
      const mockUser = createMockUser({
        password: null,
        identityProvider: IdentityProvider.GOOGLE,
      });
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

      await expect(
        authorizeCredentials({
          email: "test@example.com",
          password: "password123",
        } as any)
      ).rejects.toThrow(ErrorCode.IncorrectEmailPassword);
    });

    it("should throw error when user has no password hash with SAML identity provider", async () => {
      const mockUser = createMockUser({
        password: null,
        identityProvider: IdentityProvider.SAML,
      });
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

      await expect(
        authorizeCredentials({
          email: "test@example.com",
          password: "password123",
        } as any)
      ).rejects.toThrow(ErrorCode.IncorrectEmailPassword);
    });

    it("should throw error when user has no password hash even with TOTP code provided", async () => {
      const mockUser = createMockUser({
        password: null,
        identityProvider: IdentityProvider.CAL,
      });
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

      await expect(
        authorizeCredentials({
          email: "test@example.com",
          password: "password123",
          totpCode: "123456",
        } as any)
      ).rejects.toThrow(ErrorCode.IncorrectEmailPassword);
    });

    it("should throw error when user has no password hash with Google identity provider and TOTP code", async () => {
      const mockUser = createMockUser({
        password: null,
        identityProvider: IdentityProvider.GOOGLE,
      });
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

      await expect(
        authorizeCredentials({
          email: "test@example.com",
          password: "password123",
          totpCode: "123456",
        } as any)
      ).rejects.toThrow(ErrorCode.IncorrectEmailPassword);
    });

    it("should throw error when user has no password hash with SAML identity provider and TOTP code", async () => {
      const mockUser = createMockUser({
        password: null,
        identityProvider: IdentityProvider.SAML,
      });
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

      await expect(
        authorizeCredentials({
          email: "test@example.com",
          password: "password123",
          totpCode: "123456",
        } as any)
      ).rejects.toThrow(ErrorCode.IncorrectEmailPassword);
    });
  });

  describe("Inactive admin reason", () => {
    it("sets reason to 'both' when password is invalid and 2FA is disabled", async () => {
      const { isPasswordValid } = await import("@calcom/lib/auth/isPasswordValid");
      vi.mocked(isPasswordValid).mockReturnValue(false);
      vi.mocked(verifyPassword).mockResolvedValue(true);

      const mockUser = createMockUser({
        role: UserPermissionRole.ADMIN,
        identityProvider: IdentityProvider.CAL,
        twoFactorEnabled: false,
      });
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

      const result = await authorizeCredentials({
        email: mockUser.email,
        password: "password123",
        totpCode: "",
        backupCode: "",
      });

      expect(result?.role).toBe("INACTIVE_ADMIN");
      expect(result?.inactiveAdminReason).toBe("both");
    });

    it("sets reason to '2fa' when password is valid and 2FA is disabled", async () => {
      const { isPasswordValid } = await import("@calcom/lib/auth/isPasswordValid");
      vi.mocked(isPasswordValid).mockReturnValue(true);
      vi.mocked(verifyPassword).mockResolvedValue(true);

      const mockUser = createMockUser({
        role: UserPermissionRole.ADMIN,
        identityProvider: IdentityProvider.CAL,
        twoFactorEnabled: false,
      });
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

      const result = await authorizeCredentials({
        email: mockUser.email,
        password: "password123",
        totpCode: "",
        backupCode: "",
      });

      expect(result?.role).toBe("INACTIVE_ADMIN");
      expect(result?.inactiveAdminReason).toBe("2fa");
    });

    it("sets reason to 'password' when password is invalid and 2FA is enabled", async () => {
      const originalKey = process.env.CALENDSO_ENCRYPTION_KEY;
      process.env.CALENDSO_ENCRYPTION_KEY = "test";

      try {
        const { isPasswordValid } = await import("@calcom/lib/auth/isPasswordValid");
        vi.mocked(isPasswordValid).mockReturnValue(false);
        vi.mocked(verifyPassword).mockResolvedValue(true);

        const { symmetricDecrypt } = await import("@calcom/lib/crypto");
        vi.mocked(symmetricDecrypt).mockReturnValue("a".repeat(32));

        const { totpAuthenticatorCheck } = await import("@calcom/lib/totp");
        vi.mocked(totpAuthenticatorCheck).mockReturnValue(true);

        const mockUser = createMockUser({
          role: UserPermissionRole.ADMIN,
          identityProvider: IdentityProvider.CAL,
          twoFactorEnabled: true,
          twoFactorSecret: "encrypted_secret",
        });
        mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

        const result = await authorizeCredentials({
          email: mockUser.email,
          password: "password123",
          totpCode: "123456",
          backupCode: "",
        });

        expect(result?.role).toBe("INACTIVE_ADMIN");
        expect(result?.inactiveAdminReason).toBe("password");
      } finally {
        process.env.CALENDSO_ENCRYPTION_KEY = originalKey;
      }
    });

    it("does not set inactiveAdminReason when admin requirements are met", async () => {
      const originalKey = process.env.CALENDSO_ENCRYPTION_KEY;
      process.env.CALENDSO_ENCRYPTION_KEY = "test";

      try {
        const { isPasswordValid } = await import("@calcom/lib/auth/isPasswordValid");
        vi.mocked(isPasswordValid).mockReturnValue(true);
        vi.mocked(verifyPassword).mockResolvedValue(true);

        const { symmetricDecrypt } = await import("@calcom/lib/crypto");
        vi.mocked(symmetricDecrypt).mockReturnValue("a".repeat(32));

        const { totpAuthenticatorCheck } = await import("@calcom/lib/totp");
        vi.mocked(totpAuthenticatorCheck).mockReturnValue(true);

        const mockUser = createMockUser({
          role: UserPermissionRole.ADMIN,
          identityProvider: IdentityProvider.CAL,
          twoFactorEnabled: true,
          twoFactorSecret: "encrypted_secret",
        });
        mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(mockUser);

        const result = await authorizeCredentials({
          email: mockUser.email,
          password: "password123",
          totpCode: "123456",
          backupCode: "",
        });

        expect(result?.role).toBe(UserPermissionRole.ADMIN);
        expect(result?.inactiveAdminReason).toBeUndefined();
      } finally {
        process.env.CALENDSO_ENCRYPTION_KEY = originalKey;
      }
    });
  });

  // Flowko (U8d D-LOGIN): the login limit is keyed by account + client IP and runs before the user lookup; a
  // separate cap refuses an account for the rest of the hour after 100 failed attempts from all IPs together.
  describe("Flowko login rate limits", () => {
    const CORRECT = "correct-password";
    let ipCounter = 0;
    // A fresh client IP per call, so only the per-account cap can refuse.
    const freshIp = () => {
      ipCounter++;
      return `198.51.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
    };
    const reqFrom = (ip: string, extraHeaders: Record<string, string> = {}) => ({
      headers: { "x-forwarded-for": ip, ...extraHeaders },
    });
    type LoginCredentials = Record<"email" | "password" | "totpCode" | "backupCode", string>;
    const creds = (overrides: Partial<LoginCredentials> = {}): LoginCredentials => ({
      email: "owner@salon.si",
      password: "wrong-password",
      totpCode: "",
      backupCode: "",
      ...overrides,
    });
    // Resolves to the error code, the rate-limit marker, or "ok", so whole sequences can be compared.
    const outcome = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return "ok";
      } catch (error) {
        const message = (error as Error).message;
        return message.startsWith("Rate limit exceeded") ? "RATE_LIMITED" : message;
      }
    };
    const times = (n: number, value: string) => Array.from({ length: n }, () => value);

    beforeEach(async () => {
      ipCounter = 0;
      vi.mocked(verifyPassword).mockImplementation(async (password: string) => password === CORRECT);
      const { isPasswordValid } = await import("@calcom/lib/auth/isPasswordValid");
      vi.mocked(isPasswordValid).mockReturnValue(false);
    });

    it("refuses the 11th attempt on one account from one IP within a minute, even with the right password", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());
      const req = reqFrom("203.0.113.7");

      for (let i = 0; i < 10; i++) {
        expect(await outcome(authorizeCredentials(creds(), req))).toBe(ErrorCode.IncorrectEmailPassword);
      }
      await expect(authorizeCredentials(creds({ password: CORRECT }), req)).rejects.toThrow(
        /^Rate limit exceeded\. Try again in \d+ seconds\.$/
      );

      rateLimitState.now += 60_000;
      await expect(authorizeCredentials(creds({ password: CORRECT }), req)).resolves.toMatchObject({ id: 1 });
    });

    it("does not let attempts from one IP lock the account out for another IP", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());
      const attacker = reqFrom("203.0.113.66");

      for (let i = 0; i < 11; i++) await outcome(authorizeCredentials(creds(), attacker));
      expect(await outcome(authorizeCredentials(creds(), attacker))).toBe("RATE_LIMITED");

      await expect(
        authorizeCredentials(creds({ password: CORRECT }), reqFrom("192.0.2.10"))
      ).resolves.toMatchObject({ id: 1 });
    });

    it("keys the limit on the email as the lookup normalises it", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());
      const req = reqFrom("203.0.113.7");
      const spellings = ["owner@salon.si", "OWNER@SALON.SI", " Owner@Salon.si ", "owner@SALON.si"];

      for (let i = 0; i < 10; i++) {
        await outcome(authorizeCredentials(creds({ email: spellings[i % spellings.length] }), req));
      }
      const eleventh = await outcome(authorizeCredentials(creds({ email: "Owner@salon.SI" }), req));
      expect(eleventh).toBe("RATE_LIMITED");
    });

    it("gives a client no fresh bucket per spoofed cf-connecting-ip or true-client-ip", async () => {
      vi.stubEnv("TRUST_CLOUDFLARE_IP_HEADERS", "");
      try {
        mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());
        for (let i = 0; i < 10; i++) {
          const spoofed = reqFrom("203.0.113.7", {
            "cf-connecting-ip": `10.0.0.${i}`,
            "true-client-ip": `10.0.1.${i}`,
          });
          await outcome(authorizeCredentials(creds(), spoofed));
        }
        const eleventh = reqFrom("203.0.113.7", { "cf-connecting-ip": "10.0.0.99" });
        const result = await outcome(authorizeCredentials(creds({ password: CORRECT }), eleventh));
        expect(result).toBe("RATE_LIMITED");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("applies the limit to an email with no account exactly as to one with an account (no oracle)", async () => {
      const run = async (user: ReturnType<typeof createMockUser> | null, email: string) => {
        mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(user);
        const req = reqFrom("203.0.113.7");
        const results: string[] = [];
        for (let i = 0; i < 12; i++) results.push(await outcome(authorizeCredentials(creds({ email }), req)));
        return results;
      };

      const existing = await run(createMockUser(), "owner@salon.si");
      const missing = await run(null, "nobody@salon.si");

      expect(missing).toEqual([...times(10, ErrorCode.IncorrectEmailPassword), ...times(2, "RATE_LIMITED")]);
      expect(existing).toEqual(missing);
    });

    it("still signs in with the right password after a few failures", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());
      const req = reqFrom("203.0.113.7");

      for (let i = 0; i < 4; i++) {
        expect(await outcome(authorizeCredentials(creds(), req))).toBe(ErrorCode.IncorrectEmailPassword);
      }
      await expect(authorizeCredentials(creds({ password: CORRECT }), req)).resolves.toMatchObject({
        id: 1,
        email: "test@example.com",
      });
    });

    it("refuses the account from every IP after 100 failures in an hour, right password or not, until it resets", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());

      for (let i = 0; i < 99; i++) {
        expect(await outcome(authorizeCredentials(creds(), reqFrom(freshIp())))).toBe(
          ErrorCode.IncorrectEmailPassword
        );
      }
      // The 100th failure still gets its own error; it fills the cap.
      expect(await outcome(authorizeCredentials(creds(), reqFrom(freshIp())))).toBe(
        ErrorCode.IncorrectEmailPassword
      );

      expect(await outcome(authorizeCredentials(creds({ password: CORRECT }), reqFrom(freshIp())))).toBe(
        "RATE_LIMITED"
      );
      expect(await outcome(authorizeCredentials(creds(), reqFrom(freshIp())))).toBe("RATE_LIMITED");
      // The password is not even checked past the cap.
      vi.mocked(verifyPassword).mockClear();
      await outcome(authorizeCredentials(creds({ password: CORRECT }), reqFrom(freshIp())));
      expect(verifyPassword).not.toHaveBeenCalled();

      rateLimitState.now += 59 * 60_000;
      expect(await outcome(authorizeCredentials(creds({ password: CORRECT }), reqFrom(freshIp())))).toBe(
        "RATE_LIMITED"
      );
      rateLimitState.now += 60_000;
      await expect(
        authorizeCredentials(creds({ password: CORRECT }), reqFrom(freshIp()))
      ).resolves.toMatchObject({ id: 1 });
    });

    it("counts only failures towards the cap: successful sign-ins never use it up", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());

      for (let i = 0; i < 150; i++) {
        await expect(
          authorizeCredentials(creds({ password: CORRECT }), reqFrom(freshIp()))
        ).resolves.toMatchObject({ id: 1 });
      }
      for (let i = 0; i < 99; i++) await outcome(authorizeCredentials(creds(), reqFrom(freshIp())));
      await expect(
        authorizeCredentials(creds({ password: CORRECT }), reqFrom(freshIp()))
      ).resolves.toMatchObject({ id: 1 });
    });

    it("keeps each account's cap separate", async () => {
      const owner = createMockUser({ id: 1, email: "owner@salon.si" });
      const other = createMockUser({ id: 2, email: "other@salon.si" });
      mockFindByEmailAndIncludeProfilesAndPassword.mockImplementation(async ({ email }: { email: string }) =>
        email === "other@salon.si" ? other : owner
      );

      for (let i = 0; i < 100; i++) await outcome(authorizeCredentials(creds(), reqFrom(freshIp())));
      expect(await outcome(authorizeCredentials(creds({ password: CORRECT }), reqFrom(freshIp())))).toBe(
        "RATE_LIMITED"
      );
      await expect(
        authorizeCredentials(creds({ email: "other@salon.si", password: CORRECT }), reqFrom(freshIp()))
      ).resolves.toMatchObject({ id: 2 });
    });

    describe("second factor", () => {
      const originalKey = process.env.CALENDSO_ENCRYPTION_KEY;

      beforeEach(async () => {
        process.env.CALENDSO_ENCRYPTION_KEY = "test";
        const { symmetricDecrypt } = await import("@calcom/lib/crypto");
        vi.mocked(symmetricDecrypt).mockImplementation((value: string) =>
          value === "encrypted_backup_codes" ? JSON.stringify(["abcde12345"]) : "a".repeat(32)
        );
        const { totpAuthenticatorCheck } = await import("@calcom/lib/totp");
        vi.mocked(totpAuthenticatorCheck).mockImplementation((code: string) => code === "123456");
      });

      afterEach(() => {
        process.env.CALENDSO_ENCRYPTION_KEY = originalKey;
      });

      const twoFactorUser = (overrides: Partial<any> = {}) =>
        createMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: "encrypted_secret",
          backupCodes: "encrypted_backup_codes",
          ...overrides,
        });

      it("counts a missing or wrong 2FA code and a wrong backup code as failures, and keeps their errors", async () => {
        mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(twoFactorUser());
        const attempt = (overrides: Parameters<typeof creds>[0]) =>
          outcome(authorizeCredentials(creds({ password: CORRECT, ...overrides }), reqFrom(freshIp())));

        const results: string[] = [];
        for (let i = 0; i < 40; i++) results.push(await attempt({}));
        for (let i = 0; i < 40; i++) results.push(await attempt({ totpCode: "000000" }));
        for (let i = 0; i < 19; i++) results.push(await attempt({ backupCode: "wrong-code" }));
        expect(results).toEqual([
          ...times(40, ErrorCode.SecondFactorRequired),
          ...times(40, ErrorCode.IncorrectTwoFactorCode),
          ...times(19, ErrorCode.IncorrectBackupCode),
        ]);

        // 99 failures: a full sign-in still works and does not count.
        expect(await attempt({ totpCode: "123456" })).toBe("ok");
        expect(await attempt({ totpCode: "123456" })).toBe("ok");
        // The 100th failure fills the cap; after it even the right password and code are refused.
        expect(await attempt({ totpCode: "999999" })).toBe(ErrorCode.IncorrectTwoFactorCode);
        expect(await attempt({ totpCode: "123456" })).toBe("RATE_LIMITED");
        expect(await attempt({ backupCode: "abcde-12345" })).toBe("RATE_LIMITED");
      });

      it("counts a backup code sent for an account with no backup codes as a failure", async () => {
        mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(twoFactorUser({ backupCodes: null }));

        for (let i = 0; i < 100; i++) {
          expect(
            await outcome(
              authorizeCredentials(creds({ password: CORRECT, backupCode: "x" }), reqFrom(freshIp()))
            )
          ).toBe(ErrorCode.MissingBackupCodes);
        }
        const rightCode = creds({ password: CORRECT, totpCode: "123456" });
        expect(await outcome(authorizeCredentials(rightCode, reqFrom(freshIp())))).toBe("RATE_LIMITED");
      });
    });

    it("hides the result of attempts that finish after concurrent failures filled the cap", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(verifyPassword).mockImplementation(async (password: string) => {
        if (password.startsWith("slow-")) await gate;
        return password === CORRECT || password === "slow-correct";
      });

      for (let i = 0; i < 98; i++) await outcome(authorizeCredentials(creds(), reqFrom(freshIp())));
      // Both pass the cap check with 98 failures counted, then wait in password verification.
      const slowAttempt = (password: string) =>
        outcome(authorizeCredentials(creds({ password }), reqFrom(freshIp())));
      const slowRight = slowAttempt("slow-correct");
      const slowWrong = slowAttempt("slow-wrong");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await outcome(authorizeCredentials(creds(), reqFrom(freshIp())))).toBe(
        ErrorCode.IncorrectEmailPassword
      );
      expect(await outcome(authorizeCredentials(creds(), reqFrom(freshIp())))).toBe(
        ErrorCode.IncorrectEmailPassword
      );

      release();
      expect(await slowWrong).toBe("RATE_LIMITED");
      expect(await slowRight).toBe("RATE_LIMITED");
    });

    it("keeps a locked account's error and never caps accounts without a password, like unknown emails", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser({ locked: true }));
      expect(await outcome(authorizeCredentials(creds({ password: CORRECT }), reqFrom(freshIp())))).toBe(
        ErrorCode.UserAccountLocked
      );

      for (const user of [
        createMockUser({ password: null, identityProvider: IdentityProvider.GOOGLE }),
        null,
      ]) {
        mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(user);
        const results: string[] = [];
        for (let i = 0; i < 120; i++) {
          results.push(await outcome(authorizeCredentials(creds(), reqFrom(freshIp()))));
        }
        expect(results).toEqual(times(120, ErrorCode.IncorrectEmailPassword));
      }
    });

    it("sends the limiter only hashed emails and IPs", async () => {
      const identifiers: string[] = [];
      const limiter = rateLimitState.limiter;
      rateLimitState.limiter = async (helper) => {
        identifiers.push(helper.identifier);
        return limiter?.(helper);
      };
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser({ id: 42 }));

      await outcome(authorizeCredentials(creds({ email: " Owner@Salon.si" }), reqFrom("203.0.113.7")));

      expect(identifiers).toEqual([
        `login:${hashEmail("owner@salon.si")}:${piiHasher.hash("203.0.113.7")}`,
        "login-failures:42",
        "login-failures:42",
      ]);
      expect(identifiers.join(" ")).not.toMatch(/owner|203\.0\.113\.7/i);
    });

    it("still limits a call that carries no request headers", async () => {
      mockFindByEmailAndIncludeProfilesAndPassword.mockResolvedValue(createMockUser());
      for (let i = 0; i < 10; i++) await outcome(authorizeCredentials(creds()));
      expect(await outcome(authorizeCredentials(creds({ password: CORRECT }), {}))).toBe("RATE_LIMITED");
    });
  });
});

describe("Azure AD signIn callback", () => {
  let getOptions: typeof import("./next-auth-options").getOptions;
  let signInCallback: NonNullable<ReturnType<typeof getOptions>["callbacks"]>["signIn"];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetIdentityProvider.mockImplementation((provider: string) => {
      const map: Record<string, string> = {
        "azure-ad": "AZUREAD",
        google: "GOOGLE",
        saml: "SAML",
        "saml-idp": "SAML",
        cal: "CAL",
      };
      return map[provider] ?? null;
    });

    // Mock prisma methods used in signIn callback
    const prismaModule = await import("@calcom/prisma");
    const prismaDefault = (prismaModule as any).default;
    prismaDefault.user = {
      ...prismaDefault.user,
      findFirst: mockPrismaUserFindFirst,
      create: mockPrismaUserCreate,
      update: mockPrismaUserUpdate,
    };
    prismaDefault.team = {
      findFirst: mockPrismaTeamFindFirst,
    };
    prismaDefault.selectedCalendar = {
      create: mockPrismaSelectedCalendarCreate,
    };

    mockPrismaUserFindFirst.mockResolvedValue(null);
    mockPrismaUserCreate.mockResolvedValue({ id: 100, email: "new@example.com", twoFactorEnabled: false });
    mockPrismaUserUpdate.mockResolvedValue({});
    mockPrismaTeamFindFirst.mockResolvedValue(null);
    mockUpdateProfilePhotoMicrosoft.mockResolvedValue(undefined);

    // Setup mock adapter
    const adapterModule = await import("./next-auth-custom-adapter");
    (adapterModule.default as any).mockReturnValue({ linkAccount: mockLinkAccount });
    mockLinkAccount.mockResolvedValue(undefined);

    mockWaitUntil.mockImplementation((p: Promise<any>) => p.catch(() => {}));

    const authModule = await import("./next-auth-options");
    getOptions = authModule.getOptions;
    const options = getOptions({ getDubId: () => undefined, getTrackingData: () => ({}) as any });
    signInCallback = options.callbacks!.signIn! as any;
  });

  describe("Azure AD email verification (xms_edov)", () => {
    const baseParams = {
      user: { id: "1", email: "user@example.com", name: "User", emailVerified: null },
      account: {
        provider: "azure-ad",
        providerAccountId: "azure-123",
        type: "oauth" as const,
      },
      credentials: undefined,
      email: undefined,
    };

    it("allows login when xms_edov is true (boolean)", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        accounts: [{ provider: "azure-ad" }],
        twoFactorEnabled: false,
        identityProvider: "AZUREAD",
      });

      const result = await signInCallback({
        ...baseParams,
        profile: { email_verified: false, xms_edov: true } as any,
      } as any);

      expect(result).toBe(true);
    });

    it("allows login when xms_edov is string 'true'", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        accounts: [{ provider: "azure-ad" }],
        twoFactorEnabled: false,
        identityProvider: "AZUREAD",
      });

      const result = await signInCallback({
        ...baseParams,
        profile: { xms_edov: "true" } as any,
      } as any);

      expect(result).toBe(true);
    });

    it("allows login when xms_edov is string '1'", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        accounts: [{ provider: "azure-ad" }],
        twoFactorEnabled: false,
        identityProvider: "AZUREAD",
      });

      const result = await signInCallback({
        ...baseParams,
        profile: { xms_edov: "1" } as any,
      } as any);

      expect(result).toBe(true);
    });

    it("allows login when xms_edov is number 1", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        accounts: [{ provider: "azure-ad" }],
        twoFactorEnabled: false,
        identityProvider: "AZUREAD",
      });

      const result = await signInCallback({
        ...baseParams,
        profile: { xms_edov: 1 } as any,
      } as any);

      expect(result).toBe(true);
    });

    it("rejects login when xms_edov is false", async () => {
      const result = await signInCallback({
        ...baseParams,
        profile: { xms_edov: false } as any,
      } as any);

      expect(result).toBe("/auth/error?error=unverified-email");
    });

    it("rejects login when xms_edov is undefined", async () => {
      const result = await signInCallback({
        ...baseParams,
        profile: {} as any,
      } as any);

      expect(result).toBe("/auth/error?error=unverified-email");
    });

    it("rejects login when xms_edov is 0", async () => {
      const result = await signInCallback({
        ...baseParams,
        profile: { xms_edov: 0 } as any,
      } as any);

      expect(result).toBe("/auth/error?error=unverified-email");
    });

    it("rejects login when xms_edov is string '0'", async () => {
      const result = await signInCallback({
        ...baseParams,
        profile: { xms_edov: "0" } as any,
      } as any);

      expect(result).toBe("/auth/error?error=unverified-email");
    });

    it("allows non-AZUREAD with email_verified=true", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        accounts: [{ provider: "google" }],
        twoFactorEnabled: false,
        identityProvider: "GOOGLE",
      });

      const result = await signInCallback({
        user: { id: "1", email: "user@example.com", name: "User", emailVerified: null },
        account: { provider: "google", providerAccountId: "google-123", type: "oauth" as const },
        profile: { email_verified: true } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      expect(result).toBe(true);
    });

    it("rejects non-AZUREAD with email_verified=false", async () => {
      const result = await signInCallback({
        user: { id: "1", email: "user@example.com", name: "User", emailVerified: null },
        account: { provider: "google", providerAccountId: "google-123", type: "oauth" as const },
        profile: { email_verified: false } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      expect(result).toBe("/auth/error?error=unverified-email");
    });
  });

  describe("Azure AD profile photo on new user (signIn callback)", () => {
    const baseUser = { id: "1", email: "newuser@example.com", name: "New User", emailVerified: null };

    it("calls updateProfilePhotoMicrosoft for new Azure AD user with access_token", async () => {
      // No existing user
      mockPrismaUserFindFirst.mockResolvedValue(null);
      mockPrismaUserCreate.mockResolvedValue({
        id: 100,
        email: "newuser@example.com",
        twoFactorEnabled: false,
      });

      await signInCallback({
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-new-123",
          type: "oauth" as const,
          access_token: "new-user-token",
        },
        profile: { xms_edov: true } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      expect(mockUpdateProfilePhotoMicrosoft).toHaveBeenCalledWith("new-user-token", 100);
    });

    it("skips updateProfilePhotoMicrosoft for new Azure AD user without access_token", async () => {
      mockPrismaUserFindFirst.mockResolvedValue(null);
      mockPrismaUserCreate.mockResolvedValue({
        id: 101,
        email: "newuser@example.com",
        twoFactorEnabled: false,
      });

      await signInCallback({
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-new-456",
          type: "oauth" as const,
        },
        profile: { xms_edov: true } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      expect(mockUpdateProfilePhotoMicrosoft).not.toHaveBeenCalled();
    });

    it("skips updateProfilePhotoMicrosoft for new Google user", async () => {
      mockPrismaUserFindFirst.mockResolvedValue(null);
      mockPrismaUserCreate.mockResolvedValue({
        id: 102,
        email: "newuser@example.com",
        twoFactorEnabled: false,
      });

      await signInCallback({
        user: baseUser,
        account: {
          provider: "google",
          providerAccountId: "google-new-789",
          type: "oauth" as const,
          access_token: "google-token",
        },
        profile: { email_verified: true } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      expect(mockUpdateProfilePhotoMicrosoft).not.toHaveBeenCalled();
    });

    it("photo update failure does not crash signup", async () => {
      mockPrismaUserFindFirst.mockResolvedValue(null);
      mockPrismaUserCreate.mockResolvedValue({
        id: 103,
        email: "newuser@example.com",
        twoFactorEnabled: false,
      });
      mockUpdateProfilePhotoMicrosoft.mockRejectedValue(new Error("Photo update failed"));

      const result = await signInCallback({
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-fail-123",
          type: "oauth" as const,
          access_token: "fail-token",
        },
        profile: { xms_edov: true } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      // Should still return something (true or error redirect), not throw
      expect(result).toBeDefined();
    });
  });

  describe("Azure AD identity provider conversion (signIn callback)", () => {
    it("CAL user with verified email converts to AZUREAD on Azure AD login", async () => {
      // No existing user with AZUREAD identity
      mockPrismaUserFindFirst
        .mockResolvedValueOnce(null) // First call: lookup by identityProvider + providerAccountId
        .mockResolvedValueOnce(null) // Legacy lookup
        .mockResolvedValueOnce({
          // Lookup by email
          id: 50,
          email: "user@example.com",
          emailVerified: new Date(),
          identityProvider: "CAL",
          password: { hash: "hashed" },
          twoFactorEnabled: false,
        });

      const result = await signInCallback({
        user: { id: "1", email: "user@example.com", name: "User", emailVerified: null },
        account: { provider: "azure-ad", providerAccountId: "azure-conv-1", type: "oauth" as const },
        profile: { xms_edov: true } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      expect(mockPrismaUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identityProvider: "AZUREAD",
            identityProviderId: "azure-conv-1",
          }),
        })
      );
      expect(result).toBe(true);
    });

    it("GOOGLE user auto-merges on Azure AD login when email is verified", async () => {
      mockPrismaUserFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 51,
        email: "user@example.com",
        emailVerified: new Date(),
        identityProvider: "GOOGLE",
        password: null,
        twoFactorEnabled: false,
      });

      const result = await signInCallback({
        user: { id: "1", email: "user@example.com", name: "User", emailVerified: null },
        account: { provider: "azure-ad", providerAccountId: "azure-conv-2", type: "oauth" as const },
        profile: { xms_edov: true } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      // With isVerified=true and non-CAL provider, auto-merge path is taken (returns true directly)
      expect(result).toBe(true);
    });

    it("AZUREAD user auto-merges on Google login when email is verified", async () => {
      mockPrismaUserFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 52,
        email: "user@example.com",
        emailVerified: new Date(),
        identityProvider: "AZUREAD",
        password: null,
        twoFactorEnabled: false,
      });

      const result = await signInCallback({
        user: { id: "1", email: "user@example.com", name: "User", emailVerified: null },
        account: { provider: "google", providerAccountId: "google-conv-1", type: "oauth" as const },
        profile: { email_verified: true } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      // With isVerified=true and non-CAL provider, auto-merge path is taken (returns true directly)
      expect(result).toBe(true);
    });

    it("unverified CAL account blocks Azure AD linking (anti-hijack)", async () => {
      mockPrismaUserFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 53,
          email: "user@example.com",
          emailVerified: null,
          identityProvider: "CAL",
          password: { hash: "hashed" },
          twoFactorEnabled: false,
        });

      const result = await signInCallback({
        user: { id: "1", email: "user@example.com", name: "User", emailVerified: null },
        account: { provider: "azure-ad", providerAccountId: "azure-hijack-1", type: "oauth" as const },
        profile: { xms_edov: true } as any,
        credentials: undefined,
        email: undefined,
      } as any);

      expect(result).toBe("/auth/error?error=unverified-email");
    });
  });
});

describe("Email (magic link) signIn callback", () => {
  let getOptions: typeof import("./next-auth-options").getOptions;
  let signInCallback: NonNullable<ReturnType<typeof getOptions>["callbacks"]>["signIn"];

  const emailAccount = {
    provider: "email",
    providerAccountId: "user@example.com",
    type: "email" as const,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFindByEmail.mockReset();

    const authModule = await import("./next-auth-options");
    getOptions = authModule.getOptions;
    const options = getOptions({ getDubId: () => undefined, getTrackingData: () => ({}) as any });
    signInCallback = options.callbacks!.signIn! as any;
  });

  it("allows an existing user", async () => {
    mockFindByEmail.mockResolvedValue({ id: 1, email: "user@example.com" });

    const result = await signInCallback({
      user: { id: "1", email: "user@example.com", emailVerified: null },
      account: emailAccount,
      email: { verificationRequest: true },
    } as any);

    expect(result).toBe(true);
    expect(mockFindByEmail).toHaveBeenCalledWith({ email: "user@example.com" });
  });

  it("denies an unknown email, so no link is sent and no user is created", async () => {
    mockFindByEmail.mockResolvedValue(null);

    // next-auth passes a placeholder user (id = email) when the adapter finds no user
    const result = await signInCallback({
      user: { id: "stranger@example.com", email: "stranger@example.com", emailVerified: null },
      account: { ...emailAccount, providerAccountId: "stranger@example.com" },
      email: { verificationRequest: true },
    } as any);

    // A string makes next-auth redirect there without sending the link; it matches the answer for a sent link
    expect(result).toBe("http://localhost:3000/api/auth/verify-request?provider=email&type=email");
  });

  it("denies an unknown email when the link is opened", async () => {
    mockFindByEmail.mockResolvedValue(null);

    const result = await signInCallback({
      user: { id: "stranger@example.com", email: "stranger@example.com", emailVerified: null },
      account: { ...emailAccount, providerAccountId: "stranger@example.com" },
    } as any);

    expect(result).toBe(false);
  });

  it("denies a differently cased address, which next-auth would create as a new user", async () => {
    mockFindByEmail.mockResolvedValue({ id: 1, email: "user@example.com" });

    const result = await signInCallback({
      user: { id: "User@Example.com", email: "User@Example.com", emailVerified: null },
      account: { ...emailAccount, providerAccountId: "User@Example.com" },
    } as any);

    expect(result).toBe(false);
  });

  it("denies a locked user", async () => {
    mockFindByEmail.mockResolvedValue({ id: 1, email: "user@example.com", locked: true });

    const result = await signInCallback({
      user: { id: "1", email: "user@example.com", emailVerified: null },
      account: emailAccount,
    } as any);

    expect(result).toBe(false);
  });

  it("denies a user with 2FA enabled", async () => {
    mockFindByEmail.mockResolvedValue({ id: 1, email: "user@example.com", twoFactorEnabled: true });

    const result = await signInCallback({
      user: { id: "1", email: "user@example.com", emailVerified: null },
      account: emailAccount,
    } as any);

    expect(result).toBe(false);
  });

  it("denies without a lookup when the email is missing", async () => {
    const result = await signInCallback({
      user: { id: "1", email: null, emailVerified: null },
      account: emailAccount,
    } as any);

    expect(result).toBe(false);
    expect(mockFindByEmail).not.toHaveBeenCalled();
  });
});

describe("Azure AD JWT callback", () => {
  let getOptions: typeof import("./next-auth-options").getOptions;
  let jwtCallback: NonNullable<ReturnType<typeof getOptions>["callbacks"]>["jwt"];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    mockGetIdentityProvider.mockImplementation((provider: string) => {
      const map: Record<string, string> = {
        "azure-ad": "AZUREAD",
        google: "GOOGLE",
        saml: "SAML",
        "saml-idp": "SAML",
        cal: "CAL",
      };
      return map[provider] ?? null;
    });
    mockCredentialRepoCreate.mockResolvedValue({ id: 1 });
    mockBuildCredentialCreateData.mockImplementation((data: any) => data);
    mockUpdateProfilePhotoMicrosoft.mockResolvedValue(undefined);

    // Setup prisma mocks
    const prismaModule = await import("@calcom/prisma");
    const prismaDefault = (prismaModule as any).default;
    prismaDefault.user = {
      ...prismaDefault.user,
      findFirst: mockPrismaUserFindFirst,
    };
    prismaDefault.selectedCalendar = {
      create: mockPrismaSelectedCalendarCreate,
    };
    prismaDefault.membership = {
      findUnique: vi.fn().mockResolvedValue(null),
    };

    mockPrismaSelectedCalendarCreate.mockResolvedValue({});

    const { ProfileRepository } = await import("@calcom/features/profile/repositories/ProfileRepository");
    (ProfileRepository.findAllProfilesForUserIncludingMovedUser as any).mockResolvedValue([
      { id: 1, upId: "usr_1" },
    ]);
    (ProfileRepository.findByUpIdWithAuth as any).mockResolvedValue({
      id: 1,
      username: "testuser",
      organization: null,
    });

    const authModule = await import("./next-auth-options");
    getOptions = authModule.getOptions;
    const options = getOptions({ getDubId: () => undefined, getTrackingData: () => ({}) as any });
    jwtCallback = options.callbacks!.jwt! as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("Azure AD calendar auto-install", () => {
    const baseToken = { sub: "1", email: "user@example.com", upId: "usr_1" } as any;
    const baseUser = {
      id: "1",
      email: "user@example.com",
      name: "Test",
      username: "test",
      role: "USER",
      locale: "en",
    } as any;

    it("creates office365-calendar credential on first login with all scopes", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        name: "Test",
        username: "test",
        role: "USER",
        locale: "en",
        avatarUrl: null,
        identityProvider: "AZUREAD",
        identityProviderId: "azure-123",
        teams: [],
        movedToProfileId: null,
      });
      mockCredentialRepoFindFirst.mockResolvedValue(null);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ value: [{ id: "cal-id-1", isDefaultCalendar: true }] }),
      }) as unknown as typeof fetch;

      await jwtCallback({
        token: baseToken,
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-123",
          type: "oauth",
          access_token: "at-123",
          refresh_token: "rt-123",
          expires_at: 1700000000,
          scope: "User.Read Calendars.Read Calendars.ReadWrite offline_access",
        },
        trigger: undefined,
        session: undefined,
      } as any);

      expect(mockBuildCredentialCreateData).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: "office365-calendar",
          type: "office365_calendar",
        })
      );
      expect(mockCredentialRepoCreate).toHaveBeenCalled();
    });

    it("skips creation when office365-calendar credential already exists", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        name: "Test",
        username: "test",
        role: "USER",
        locale: "en",
        avatarUrl: null,
        identityProvider: "AZUREAD",
        identityProviderId: "azure-123",
        teams: [],
        movedToProfileId: null,
      });
      mockCredentialRepoFindFirst.mockResolvedValue({ id: 99 });

      await jwtCallback({
        token: baseToken,
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-123",
          type: "oauth",
          access_token: "at-123",
          scope: "User.Read Calendars.Read Calendars.ReadWrite",
        },
        trigger: undefined,
        session: undefined,
      } as any);

      expect(mockBuildCredentialCreateData).not.toHaveBeenCalledWith(
        expect.objectContaining({ appId: "office365-calendar" })
      );
    });

    it("skips creation when calendar scopes are missing", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        name: "Test",
        username: "test",
        role: "USER",
        locale: "en",
        avatarUrl: null,
        identityProvider: "AZUREAD",
        identityProviderId: "azure-123",
        teams: [],
        movedToProfileId: null,
      });
      mockCredentialRepoFindFirst.mockResolvedValue(null);

      await jwtCallback({
        token: baseToken,
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-123",
          type: "oauth",
          access_token: "at-123",
          scope: "User.Read",
        },
        trigger: undefined,
        session: undefined,
      } as any);

      expect(mockCredentialRepoCreate).not.toHaveBeenCalled();
    });

    it("offline_access is excluded from scope check", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        name: "Test",
        username: "test",
        role: "USER",
        locale: "en",
        avatarUrl: null,
        identityProvider: "AZUREAD",
        identityProviderId: "azure-123",
        teams: [],
        movedToProfileId: null,
      });
      mockCredentialRepoFindFirst.mockResolvedValue(null);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      }) as unknown as typeof fetch;

      // Scope without offline_access — should still pass scope check
      await jwtCallback({
        token: baseToken,
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-123",
          type: "oauth",
          access_token: "at-123",
          scope: "User.Read Calendars.Read Calendars.ReadWrite",
        },
        trigger: undefined,
        session: undefined,
      } as any);

      expect(mockCredentialRepoCreate).toHaveBeenCalled();
    });

    it("fetches default calendar and creates selectedCalendar", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        name: "Test",
        username: "test",
        role: "USER",
        locale: "en",
        avatarUrl: null,
        identityProvider: "AZUREAD",
        identityProviderId: "azure-123",
        teams: [],
        movedToProfileId: null,
      });
      mockCredentialRepoFindFirst.mockResolvedValue(null);
      mockCredentialRepoCreate.mockResolvedValue({ id: 77 });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            value: [
              { id: "non-default-cal", isDefaultCalendar: false },
              { id: "default-cal-id", isDefaultCalendar: true },
            ],
          }),
      }) as unknown as typeof fetch;

      await jwtCallback({
        token: baseToken,
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-123",
          type: "oauth",
          access_token: "at-123",
          scope: "User.Read Calendars.Read Calendars.ReadWrite",
        },
        trigger: undefined,
        session: undefined,
      } as any);

      expect(mockPrismaSelectedCalendarCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          integration: "office365_calendar",
          externalId: "default-cal-id",
          credentialId: 77,
        }),
      });
    });

    it("Graph API fetch failure logs error but does not crash", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        name: "Test",
        username: "test",
        role: "USER",
        locale: "en",
        avatarUrl: null,
        identityProvider: "AZUREAD",
        identityProviderId: "azure-123",
        teams: [],
        movedToProfileId: null,
      });
      mockCredentialRepoFindFirst.mockResolvedValue(null);
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

      // Should not throw
      const result = await jwtCallback({
        token: baseToken,
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-123",
          type: "oauth",
          access_token: "at-123",
          scope: "User.Read Calendars.Read Calendars.ReadWrite",
        },
        trigger: undefined,
        session: undefined,
      } as any);

      expect(result).toBeDefined();
    });

    it("calls updateProfilePhotoMicrosoft after calendar install", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        name: "Test",
        username: "test",
        role: "USER",
        locale: "en",
        avatarUrl: null,
        identityProvider: "AZUREAD",
        identityProviderId: "azure-123",
        teams: [],
        movedToProfileId: null,
      });
      mockCredentialRepoFindFirst.mockResolvedValue(null);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      }) as unknown as typeof fetch;

      await jwtCallback({
        token: baseToken,
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-123",
          type: "oauth",
          access_token: "photo-token",
          scope: "User.Read Calendars.Read Calendars.ReadWrite",
        },
        trigger: undefined,
        session: undefined,
      } as any);

      expect(mockUpdateProfilePhotoMicrosoft).toHaveBeenCalledWith("photo-token", 1);
    });

    it("calls updateProfilePhotoMicrosoft even when calendar already installed (else-if branch)", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        name: "Test",
        username: "test",
        role: "USER",
        locale: "en",
        avatarUrl: null,
        identityProvider: "AZUREAD",
        identityProviderId: "azure-123",
        teams: [],
        movedToProfileId: null,
      });
      // Calendar credential already exists
      mockCredentialRepoFindFirst.mockResolvedValue({ id: 99 });

      await jwtCallback({
        token: baseToken,
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-123",
          type: "oauth",
          access_token: "photo-token-2",
          scope: "User.Read Calendars.Read Calendars.ReadWrite",
        },
        trigger: undefined,
        session: undefined,
      } as any);

      expect(mockUpdateProfilePhotoMicrosoft).toHaveBeenCalledWith("photo-token-2", 1);
    });

    it("converts expires_at from seconds to milliseconds in credential key", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: 1,
        email: "user@example.com",
        name: "Test",
        username: "test",
        role: "USER",
        locale: "en",
        avatarUrl: null,
        identityProvider: "AZUREAD",
        identityProviderId: "azure-123",
        teams: [],
        movedToProfileId: null,
      });
      mockCredentialRepoFindFirst.mockResolvedValue(null);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      }) as unknown as typeof fetch;

      const expiresAtSeconds = 1700000000;

      await jwtCallback({
        token: baseToken,
        user: baseUser,
        account: {
          provider: "azure-ad",
          providerAccountId: "azure-123",
          type: "oauth",
          access_token: "at-123",
          refresh_token: "rt-123",
          expires_at: expiresAtSeconds,
          scope: "User.Read Calendars.Read Calendars.ReadWrite",
        },
        trigger: undefined,
        session: undefined,
      } as any);

      expect(mockBuildCredentialCreateData).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.objectContaining({
            expiry_date: expiresAtSeconds * 1000,
          }),
        })
      );
    });
  });
});
