DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bet_selection_enum') THEN
    CREATE TYPE bet_selection_enum AS ENUM ('home', 'draw', 'away');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bet_status_enum') THEN
    CREATE TYPE bet_status_enum AS ENUM ('pending', 'won', 'lost', 'cancelled');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  selection bet_selection_enum NOT NULL,
  selection_label TEXT NOT NULL,
  stake NUMERIC(12, 2) NOT NULL,
  odds NUMERIC(8, 2) NOT NULL,
  potential_payout NUMERIC(12, 2) NOT NULL,
  status bet_status_enum NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bets_user_id_created_at
  ON bets(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bets_match_id
  ON bets(match_id);

CREATE INDEX IF NOT EXISTS idx_bets_status
  ON bets(status);
