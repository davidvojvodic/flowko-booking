-- Flowko U9: Google's OAuth policy requires tokens encrypted at rest. The app keeps them only in "encryptedKey"
-- (AES-256-GCM); "key" holds the placeholder {"_enc":"keyring-v1"}. Refuse any INSERT or UPDATE that would put an
-- OAuth token field into "key", from any code path.
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_key_no_plaintext_oauth_tokens"
  CHECK (("key")::text !~ '(access_token|refresh_token|id_token)');
