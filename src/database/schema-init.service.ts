import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SchemaInitService implements OnModuleInit {
  private readonly logger = new Logger(SchemaInitService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    // Toujours : colonne users.balance (sinon GET /wallet/* → 500 si la table users existe sans cette colonne)
    await this.ensureUsersBalanceColumn();
    await this.ensureDefaultAdminAccount();

    const enabledRaw = this.configService.get<string>('AUTO_CREATE_SCHEMA');
    const enabled = enabledRaw === 'true' || enabledRaw === '1';
    if (!enabled) return;

    await this.ensureWalletTransactionsSchema();
    await this.ensureBetsSchema();
    await this.ensureStripeColumnsSchema();
  }

  /** Idempotent — nécessaire pour le portefeuille (TypeORM lit users.balance). */
  private async ensureUsersBalanceColumn() {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "balance" numeric(12, 2) NOT NULL DEFAULT 0;
      `);
      this.logger.log('users.balance: OK');
    } catch (e) {
      this.logger.warn(
        `users.balance: impossible d'ajouter la colonne (${(e as Error).message}). Vérifie les droits DB.`,
      );
    } finally {
      await runner.release();
    }
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

  /** Crée (ou promeut) un compte admin par défaut de manière idempotente. */
  private async ensureDefaultAdminAccount() {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    const adminEmail =
      this.configService.get<string>('DEFAULT_ADMIN_EMAIL')?.trim() ||
      'admin@gmail.com';
    const adminPassword =
      this.configService.get<string>('DEFAULT_ADMIN_PASSWORD') || 'admin123';
    const adminDisplayName =
      this.configService.get<string>('DEFAULT_ADMIN_DISPLAY_NAME') ||
      'FootSmart Admin';

    try {
      const existing = await runner.query(
        `
        SELECT "id", "role"
        FROM "users"
        WHERE lower("email") = lower($1)
        LIMIT 1
        `,
        [adminEmail],
      );

      if (Array.isArray(existing) && existing.length > 0) {
        const current = existing[0] as { id: string; role: string };
        const passwordHash = await bcrypt.hash(adminPassword, 10);
        if (current.role !== 'admin') {
          await runner.query(
            `
            UPDATE "users"
            SET "role" = 'admin',
                "password_hash" = $2,
                "display_name" = COALESCE(NULLIF("display_name", ''), $3),
                "account_status" = 'active',
                "updated_at" = now()
            WHERE "id" = $1
            `,
            [current.id, passwordHash, adminDisplayName],
          );
          this.logger.warn(
            `Compte ${adminEmail} promu en admin automatiquement.`,
          );
        } else {
          await runner.query(
            `
            UPDATE "users"
            SET "password_hash" = $2,
                "display_name" = COALESCE(NULLIF("display_name", ''), $3),
                "account_status" = 'active',
                "updated_at" = now()
            WHERE "id" = $1
            `,
            [current.id, passwordHash, adminDisplayName],
          );
          this.logger.log(
            'Compte admin par defaut: deja present (mot de passe reinitialise).',
          );
        }
        return;
      }

      const passwordHash = await bcrypt.hash(adminPassword, 10);

      await runner.query(
        `
        INSERT INTO "users" (
          "email",
          "password_hash",
          "display_name",
          "is_18_plus",
          "balance",
          "points",
          "role",
          "kyc_status",
          "account_status",
          "created_at",
          "updated_at"
        )
        VALUES (
          $1,
          $2,
          $3,
          true,
          0,
          0,
          'admin',
          'not_started',
          'active',
          now(),
          now()
        )
        `,
        [adminEmail, passwordHash, adminDisplayName],
      );

      this.logger.warn(
        `Compte admin par defaut cree: ${adminEmail} (change DEFAULT_ADMIN_PASSWORD en production).`,
      );
    } catch (e) {
      this.logger.warn(
        `Compte admin par defaut: impossible de verifier/creer (${(e as Error).message}).`,
      );
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

