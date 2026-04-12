-- À exécuter dans Supabase → SQL Editor si GET /api/wallet/* renvoie 500
-- et que la table wallet_transactions n’existe pas (AUTO_CREATE_SCHEMA=false).

-- 1) Solde (normalement ajouté au démarrage du backend, sinon exécuter :)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS balance numeric(12, 2) NOT NULL DEFAULT 0;

-- 2) Table d’historique (si absente)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  CREATE TYPE wallet_transactions_type_enum AS ENUM ('deposit','withdraw','bet','win');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type wallet_transactions_type_enum NOT NULL,
  amount numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_wallet_transactions PRIMARY KEY (id),
  CONSTRAINT fk_wallet_transactions_user FOREIGN KEY (user_id)
    REFERENCES public.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created
  ON public.wallet_transactions (user_id, created_at DESC);

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id character varying(255) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_transactions_stripe_pi
  ON public.wallet_transactions (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
