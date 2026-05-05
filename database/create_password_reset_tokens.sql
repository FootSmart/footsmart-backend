CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token varchar NOT NULL UNIQUE,
  "expiresAt" timestamp NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
ON password_reset_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token
ON password_reset_tokens(token);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
ON password_reset_tokens("expiresAt");
