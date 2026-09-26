-- Flowko U9: Google's OAuth policy requires tokens encrypted at rest. The app keeps them only in "encryptedKey"
-- (AES-256-GCM); "key" holds the placeholder {"_enc":"keyring-v1"}. This backstop refuses, from any code path,
-- an INSERT or UPDATE of a "Credential" row that
--   (a) puts an OAuth token field into "key": access_token, refresh_token or id_token, in any case and with or
--       without the underscore (accessToken, REFRESH_TOKEN, idtoken, ...), as a name or inside a value; or
--   (b) is a google_calendar or google_video row whose "key" is not exactly the placeholder, or whose
--       "encryptedKey" is NULL or empty.
-- It is a trigger, not a CHECK: a CHECK violation's DETAIL ("Failing row contains (...)") would copy the refused
-- token into the app and Postgres logs. The trigger raises SQLSTATE 23514 with a fixed message, no DETAIL or
-- HINT, and nothing from the row. A later migration removes it with
--   DROP TRIGGER IF EXISTS "flowko_credential_key_guard" ON "Credential";
--   DROP FUNCTION IF EXISTS "flowko_credential_key_guard"();
-- The rules appear twice below, in the pre-check and in the trigger function; keep the two copies identical.

-- Fail loudly, before anything is created, when an existing row already breaks the rules
DO $$
DECLARE
  violating_rows bigint;
BEGIN
  SELECT count(*) INTO violating_rows
  FROM "Credential" AS c
  WHERE NOT coalesce(
    c."key"::text !~* '(access_?token|refresh_?token|id_?token)'
    AND (
      c."type" NOT IN ('google_calendar', 'google_video')
      OR (c."key" = '{"_enc":"keyring-v1"}'::jsonb AND c."encryptedKey" IS NOT NULL AND c."encryptedKey" <> '')
    ),
    false
  );
  IF violating_rows > 0 THEN
    RAISE EXCEPTION 'Flowko U9: % existing "Credential" row(s) hold an OAuth token field in key or an invalid Google credential shape; fix or remove them before this migration', violating_rows;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION "flowko_credential_key_guard"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT coalesce(
    NEW."key"::text !~* '(access_?token|refresh_?token|id_?token)'
    AND (
      NEW."type" NOT IN ('google_calendar', 'google_video')
      OR (NEW."key" = '{"_enc":"keyring-v1"}'::jsonb AND NEW."encryptedKey" IS NOT NULL AND NEW."encryptedKey" <> '')
    ),
    false
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Credential write refused: OAuth token field in key, or invalid encrypted Google credential shape';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "flowko_credential_key_guard" ON "Credential";
CREATE TRIGGER "flowko_credential_key_guard"
  BEFORE INSERT OR UPDATE ON "Credential"
  FOR EACH ROW EXECUTE FUNCTION "flowko_credential_key_guard"();

-- Fire under every session_replication_role, as a CHECK would be enforced
ALTER TABLE "Credential" ENABLE ALWAYS TRIGGER "flowko_credential_key_guard";
