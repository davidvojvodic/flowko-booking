import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Flowko U9: Google Calendar tokens are stored only encrypted, in Credential.encryptedKey; Credential.key
// holds the placeholder {"_enc":"keyring-v1"}. Two deploy-time pieces keep that true in production, and
// losing either fails silently: the DB CHECK that refuses token fields in "key" from any code path, and
// Turbo's passthrough of the keyring variables (Turbo's strict env mode strips undeclared variables, so the
// app would never see a key).

const REPO_ROOT = path.join(__dirname, "..", "..");
const MIGRATION_SQL = path.join(
  __dirname,
  "migrations",
  "20260925120000_flowko_credential_no_plaintext_oauth_tokens",
  "migration.sql"
);

const sqlStatements = fs
  .readFileSync(MIGRATION_SQL, "utf8")
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim();

// The CHECK's pattern is a plain alternation of literals, which matches the same way as a POSIX regex in
// Postgres (case-sensitive `~`) and as a JavaScript RegExp.
const checkPattern = new RegExp(/!~ '([^']+)'/.exec(sqlStatements)?.[1] ?? "(?!)");
const passesCheck = (key: unknown) => !checkPattern.test(JSON.stringify(key));

describe("Credential.key CHECK migration", () => {
  it("adds one validated CHECK that refuses OAuth token fields in key", () => {
    expect(sqlStatements).toBe(
      `ALTER TABLE "Credential" ADD CONSTRAINT "Credential_key_no_plaintext_oauth_tokens" CHECK (("key")::text !~ '(access_token|refresh_token|id_token)');`
    );
    // Without NOT VALID, Postgres checks the existing rows too: the constraint is validated, or the
    // migration fails
    expect(sqlStatements).not.toMatch(/NOT VALID/i);
  });

  it("refuses a Google token object and any token field, nested ones included", () => {
    expect(
      passesCheck({
        access_token: "x",
        refresh_token: "y",
        scope: "https://www.googleapis.com/auth/calendar.events",
        token_type: "Bearer",
        expiry_date: 1,
      })
    ).toBe(false);
    expect(passesCheck({ access_token: "x" })).toBe(false);
    expect(passesCheck({ refresh_token: "y" })).toBe(false);
    expect(passesCheck({ id_token: "z" })).toBe(false);
    expect(passesCheck({ tokens: { refresh_token: "y" } })).toBe(false);
  });

  it("accepts the encrypted-key placeholder and the keys other enabled writes store", () => {
    expect(passesCheck({ _enc: "keyring-v1" })).toBe(true);
    expect(passesCheck({})).toBe(true);
    // Apps whose key is already a symmetricEncrypt'ed string (CalDAV, Apple, Exchange, ICS)
    expect(passesCheck("0f1e2d3c4b5a69788796a5b4c3d2e1f0:00ff00ff")).toBe(true);
    // The payment apps whose Setup pages may still edit their key (U9h's allowlist)
    expect(passesCheck({ client_id: "id", secret_key: "secret" })).toBe(true);
    expect(
      passesCheck({
        account_id: "a",
        account_email: "e",
        account_lightning_address: "l",
        webhook_endpoint_id: "w",
        webhook_endpoint_secret: "s",
      })
    ).toBe(true);
  });
});

describe("turbo.json passes the credentials keyring through to the app", () => {
  const turbo = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "turbo.json"), "utf8")) as {
    globalEnv?: string[];
    globalPassThroughEnv?: string[] | null;
  };
  const passThrough = turbo.globalPassThroughEnv ?? [];
  const passedThrough = (name: string) =>
    passThrough.some((pattern) =>
      new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(name)
    );

  it("passes CURRENT and every kid variable through", () => {
    expect(passThrough).toContain("CALCOM_KEYRING_CREDENTIALS_*");
    expect(passedThrough("CALCOM_KEYRING_CREDENTIALS_CURRENT")).toBe(true);
    expect(passedThrough("CALCOM_KEYRING_CREDENTIALS_K1")).toBe(true);
    expect(passedThrough("CALCOM_KEYRING_CREDENTIALS_K2")).toBe(true);
  });

  it("keeps the key material out of the hashed globalEnv", () => {
    expect((turbo.globalEnv ?? []).filter((name) => name.startsWith("CALCOM_KEYRING_"))).toEqual([]);
  });
});

describe(".env.example documents the keyring without a key", () => {
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");

  it("names CURRENT=K1 and leaves K1 empty", () => {
    expect(envExample).toMatch(/^CALCOM_KEYRING_CREDENTIALS_CURRENT=K1$/m);
    expect(envExample).toMatch(/^CALCOM_KEYRING_CREDENTIALS_K1=$/m);
  });
});
