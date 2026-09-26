import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Flowko U9: Google Calendar tokens are stored only encrypted, in Credential.encryptedKey; Credential.key
// holds the placeholder {"_enc":"keyring-v1"}. Two deploy-time pieces keep that true in production, and
// losing either fails silently: the DB trigger that refuses token fields in "key" and any other Google row
// shape from any code path, and Turbo's passthrough of the keyring variables (Turbo's strict env mode strips
// undeclared variables, so the app would never see a key).

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

const REFUSAL =
  "RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Credential write refused: OAuth token field in key, or invalid encrypted Google credential shape';";

const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  const end = start === -1 ? -1 : text.indexOf(to, start + from.length);
  return start === -1 || end === -1 ? "" : text.slice(start + from.length, end);
};
const precheck = between(sqlStatements, "DO $$", "$$;");
const guardFunction = between(sqlStatements, 'CREATE OR REPLACE FUNCTION "flowko_credential_key_guard"()', "$$;");
// The rules, as the pre-check and the trigger each spell them, with the row alias made neutral
const rulesOf = (block: string, alias: string) =>
  between(block, "NOT coalesce(", ", false )").split(`${alias}."`).join('ROW."');

// A JavaScript model of the rules, built from the SQL itself: the token pattern (a plain alternation of
// literals, which a POSIX regex in Postgres and a JavaScript RegExp match the same way; `~*` is
// case-insensitive), the Google types and the placeholder. jsonb's text form differs from JSON.stringify only
// in whitespace, which the pattern ignores.
const guardRules = rulesOf(guardFunction, "NEW");
const tokenPattern = new RegExp(/!~\* '([^']+)'/.exec(guardRules)?.[1] ?? "(?!)", "i");
const googleTypes = (/NOT IN \(([^)]+)\)/.exec(guardRules)?.[1] ?? "")
  .split(",")
  .map((t) => t.trim().replace(/^'|'$/g, ""));
const placeholder = JSON.parse(/ = '(\{[^']+\})'::jsonb/.exec(guardRules)?.[1] ?? "null");
const allowed = (type: string, key: unknown, encryptedKey: string | null = null) =>
  key !== undefined &&
  !tokenPattern.test(JSON.stringify(key)) &&
  (!googleTypes.includes(type) ||
    (JSON.stringify(key) === JSON.stringify(placeholder) && encryptedKey !== null && encryptedKey !== ""));

const ENVELOPE = JSON.stringify({
  v: 1,
  alg: "AES-256-GCM",
  ring: "CREDENTIALS",
  kid: "K1",
  nonce: "AAAAAAAAAAAAAAAA",
  ct: "abc",
  tag: "AAAAAAAAAAAAAAAAAAAAAA",
});

describe("Credential.key backstop migration", () => {
  it("replaces the CHECK with a BEFORE INSERT OR UPDATE row trigger that always fires", () => {
    // A CHECK violation's DETAIL ("Failing row contains (...)") would copy the refused token into the logs
    expect(sqlStatements).not.toMatch(/ADD CONSTRAINT|CHECK \(/i);
    expect(sqlStatements).toContain(
      'CREATE OR REPLACE FUNCTION "flowko_credential_key_guard"() RETURNS trigger LANGUAGE plpgsql AS $$'
    );
    expect(sqlStatements).toContain(
      'DROP TRIGGER IF EXISTS "flowko_credential_key_guard" ON "Credential"; CREATE TRIGGER "flowko_credential_key_guard" BEFORE INSERT OR UPDATE ON "Credential" FOR EACH ROW EXECUTE FUNCTION "flowko_credential_key_guard"();'
    );
    expect(sqlStatements).toContain(
      'ALTER TABLE "Credential" ENABLE ALWAYS TRIGGER "flowko_credential_key_guard";'
    );
  });

  it("refuses with SQLSTATE 23514 and a fixed message, never with anything from the row", () => {
    expect(guardFunction).toContain(`THEN ${REFUSAL} END IF; RETURN NEW; END`);
    expect(guardFunction.match(/RAISE/g)).toHaveLength(1);
    expect(guardFunction).not.toMatch(/DETAIL|HINT|%|format\(|\|\|/i);
  });

  it("checks the existing rows with the same rules and fails before creating anything", () => {
    expect(precheck).not.toBe("");
    expect(rulesOf(precheck, "c")).not.toBe("");
    expect(rulesOf(precheck, "c")).toBe(guardRules);
    expect(precheck).toMatch(/FROM "Credential" AS c WHERE NOT coalesce\(/);
    expect(precheck).toMatch(/IF violating_rows > 0 THEN RAISE EXCEPTION '/);
    expect(sqlStatements.indexOf("DO $$")).toBeLessThan(sqlStatements.indexOf("CREATE OR REPLACE FUNCTION"));
  });

  it("refuses a Google token object and any token field, in any case, nested or in a value", () => {
    expect(
      allowed("stripe_payment", {
        access_token: "x",
        refresh_token: "y",
        scope: "https://www.googleapis.com/auth/calendar.events",
        token_type: "Bearer",
        expiry_date: 1,
      })
    ).toBe(false);
    for (const name of ["access_token", "refresh_token", "id_token", "accessToken", "RefreshToken", "ID_TOKEN"]) {
      expect(allowed("x_other", { [name]: "x" })).toBe(false);
    }
    expect(allowed("x_other", { accesstoken: "x", idtoken: "z" })).toBe(false);
    expect(allowed("x_other", { tokens: { refresh_token: "y" } })).toBe(false);
    expect(allowed("x_other", JSON.stringify({ access_token: "x" }))).toBe(false);
    // Over-matches no stored key: the only such names in the codebase are error strings and test fixtures
    expect(allowed("x_other", { error: "invalid_token" })).toBe(false);
    expect(allowed("x_other", undefined)).toBe(false);
  });

  it("accepts the keys the other apps store, including every non-OAuth shape", () => {
    expect(allowed("zapier_automation", {})).toBe(true);
    // Apps whose key is already a symmetricEncrypt'ed hex string (CalDAV, Apple, Exchange, ICS)
    expect(allowed("caldav_calendar", "0f1e2d3c4b5a69788796a5b4c3d2e1f0:00ff00ff")).toBe(true);
    expect(allowed("sendgrid_other_calendar", { encrypted: "0f1e2d3c:00ff" })).toBe(true);
    // The payment apps whose Setup pages may still edit their key (U9h's allowlist)
    expect(allowed("paypal_payment", { client_id: "id", secret_key: "secret", webhook_id: "w" })).toBe(true);
    expect(
      allowed("alby_payment", {
        account_id: "a",
        account_email: "e",
        account_lightning_address: "l",
        webhook_endpoint_id: "w",
        webhook_endpoint_secret: "s",
      })
    ).toBe(true);
    expect(
      allowed("hitpay_payment", {
        prod: { apiKey: "k", saltKey: "s" },
        sandbox: { apiKey: "k", saltKey: "s" },
        isSandbox: false,
      })
    ).toBe(true);
    expect(
      allowed("btcpayserver_payment", {
        serverUrl: "https://btcpay.example.com",
        storeId: "s",
        apiKey: "k",
        webhookSecret: "w",
      })
    ).toBe(true);
    expect(allowed("vital_other", { userVitalId: "u" })).toBe(true);
    expect(allowed("daily_video", { apikey: "k" })).toBe(true);
  });

  it("accepts a Google row only as the placeholder with a non-empty encryptedKey", () => {
    expect(googleTypes).toEqual(["google_calendar", "google_video"]);
    expect(placeholder).toEqual({ _enc: "keyring-v1" });
    for (const type of googleTypes) {
      expect(allowed(type, { _enc: "keyring-v1" }, ENVELOPE)).toBe(true);
      expect(allowed(type, { _enc: "keyring-v1" }, null)).toBe(false);
      expect(allowed(type, { _enc: "keyring-v1" }, "")).toBe(false);
      expect(allowed(type, {}, ENVELOPE)).toBe(false);
      expect(allowed(type, "", ENVELOPE)).toBe(false);
      expect(allowed(type, null, ENVELOPE)).toBe(false);
      expect(allowed(type, { _enc: "keyring-v1", scope: "s" }, ENVELOPE)).toBe(false);
      expect(allowed(type, { access_token: "x", refresh_token: "y" }, ENVELOPE)).toBe(false);
    }
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
