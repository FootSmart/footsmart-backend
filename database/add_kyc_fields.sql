ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status VARCHAR(30) DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(30) DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS kyc_provider VARCHAR(50),
  ADD COLUMN IF NOT EXISTS kyc_reference_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT;

ALTER TABLE users
  ALTER COLUMN account_status SET DEFAULT 'inactive';

UPDATE users
SET account_status = COALESCE(account_status, 'inactive'),
    kyc_status = COALESCE(kyc_status, 'not_started');

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('inactive', 'active', 'suspended', 'self_excluded'));
