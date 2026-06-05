ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github')),
  provider_user_id TEXT NOT NULL,
  provider_username TEXT,
  provider_email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  UNIQUE (provider, provider_user_id),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id
ON auth_identities(user_id);

CREATE INDEX IF NOT EXISTS idx_auth_identities_provider_email
ON auth_identities(provider, provider_email);
