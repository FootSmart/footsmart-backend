-- FootSmart betting lifecycle schema additions (idempotent)
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS bet_closes_at timestamptz NULL;

ALTER TABLE bets
ADD COLUMN IF NOT EXISTS payout_credited boolean NOT NULL DEFAULT false;

ALTER TABLE bets
ADD COLUMN IF NOT EXISTS result text NULL;

ALTER TABLE bets
ADD COLUMN IF NOT EXISTS settled_by text NULL;
