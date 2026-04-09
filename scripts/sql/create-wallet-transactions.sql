-- Table wallet_transactions (entité WalletTransaction)
-- À exécuter sur la même base que SCRAPFOOT_DATABASE_URL (ex. SQL Editor Supabase / psql)

DO $$
BEGIN
  CREATE TYPE "wallet_transactions_type_enum" AS ENUM (
    'deposit',
    'withdraw',
    'bet',
    'win'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "wallet_transactions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "type" "wallet_transactions_type_enum" NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_wallet_transactions_id" PRIMARY KEY ("id"),
  CONSTRAINT "FK_wallet_transactions_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IDX_wallet_transactions_user_id_created_at"
  ON "wallet_transactions" ("user_id", "created_at" DESC);
