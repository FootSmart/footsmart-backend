import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

@Injectable()
export class SchemaInitService implements OnModuleInit {
  private readonly logger = new Logger(SchemaInitService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const enabledRaw = this.configService.get<string>('AUTO_CREATE_SCHEMA');
    const enabled = enabledRaw === 'true' || enabledRaw === '1';
    if (!enabled) return;

    await this.ensureWalletTransactionsSchema();
    await this.ensureBetsSchema();
    await this.ensureStripeColumnsSchema();
  }

  private async ensureWalletTransactionsSchema() {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    try {
      const existing = await runner.query(
        `select to_regclass('public.wallet_transactions') as regclass`,
      );

      if (existing?.[0]?.regclass) {
        this.logger.log('wallet_transactions: OK');
        return;
      }

      this.logger.warn(
        'wallet_transactions: manquante, création automatique (AUTO_CREATE_SCHEMA=true)',
      );

      // gen_random_uuid() (pgcrypto) est disponible sur Supabase, mais on sécurise.
      await runner.query(`create extension if not exists "pgcrypto"`);

      await runner.query(`
DO $$
BEGIN
  CREATE TYPE "wallet_transactions_type_enum" AS ENUM ('deposit','withdraw','bet','win');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
      `);

      await runner.query(`
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "type" "wallet_transactions_type_enum" NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_wallet_transactions_id" PRIMARY KEY ("id"),
  CONSTRAINT "FK_wallet_transactions_user_id" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE CASCADE
);
      `);

      await runner.query(`
CREATE INDEX IF NOT EXISTS "IDX_wallet_transactions_user_id_created_at"
  ON "wallet_transactions" ("user_id", "created_at" DESC);
      `);

      this.logger.log('wallet_transactions: créée');
    } finally {
      await runner.release();
    }
  }

  private async ensureBetsSchema() {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    try {
      const existing = await runner.query(
        `select to_regclass('public.bets') as regclass`,
      );

      if (existing?.[0]?.regclass) {
        this.logger.log('bets: OK');
        return;
      }

      this.logger.warn('bets: manquante, création automatique (AUTO_CREATE_SCHEMA=true)');

      await runner.query(`create extension if not exists "pgcrypto"`);

      // Types ENUM attendus par TypeORM Postgres driver:
      // ${tableName}_${columnName}_enum -> bets_selection_enum / bets_status_enum
      await runner.query(`
DO $$
BEGIN
  CREATE TYPE "bets_selection_enum" AS ENUM ('home','draw','away');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
      `);

      await runner.query(`
DO $$
BEGIN
  CREATE TYPE "bets_status_enum" AS ENUM ('pending','won','lost','cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
      `);

      await runner.query(`
CREATE TABLE IF NOT EXISTS "bets" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "match_id" text NOT NULL,
  "home_team" text NOT NULL,
  "away_team" text NOT NULL,
  "selection" "bets_selection_enum" NOT NULL,
  "selection_label" text NOT NULL,
  "stake" numeric(12, 2) NOT NULL,
  "odds" numeric(8, 2) NOT NULL,
  "potential_payout" numeric(12, 2) NOT NULL,
  "status" "bets_status_enum" NOT NULL DEFAULT 'pending',
  "settled_at" timestamptz NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "PK_bets_id" PRIMARY KEY ("id"),
  CONSTRAINT "FK_bets_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);
      `);

      await runner.query(`
CREATE INDEX IF NOT EXISTS "IDX_bets_user_id_created_at"
  ON "bets" ("user_id", "created_at" DESC);
      `);

      this.logger.log('bets: créée');
    } finally {
      await runner.release();
    }
  }

  /** Colonnes Stripe (users / wallet_transactions) — sans toucher au reste du schéma */
  private async ensureStripeColumnsSchema() {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" character varying(255) NULL;
      `);
      await runner.query(`
        ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "stripe_payment_intent_id" character varying(255) NULL;
      `);
      await runner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wallet_transactions_stripe_pi"
        ON "wallet_transactions" ("stripe_payment_intent_id")
        WHERE "stripe_payment_intent_id" IS NOT NULL;
      `);
      this.logger.log('Stripe DB columns: OK');
    } finally {
      await runner.release();
    }
  }
}

