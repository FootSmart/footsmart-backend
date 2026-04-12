import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

function normalizeEnvKey(raw: string | undefined): string {
  if (!raw) return '';
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  // any pour éviter les soucis de typing selon config TS du repo
  private readonly stripe: any;
  private readonly publishableKey: string;

  constructor(private readonly configService: ConfigService) {
    const secretKey = normalizeEnvKey(
      this.configService.get<string>('STRIPE_SECRET_KEY'),
    );
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    if (!/^sk_(test|live)_/.test(secretKey)) {
      throw new Error(
        'STRIPE_SECRET_KEY doit commencer par sk_test_ ou sk_live_ (clé secrète standard).',
      );
    }

    this.publishableKey = normalizeEnvKey(
      this.configService.get<string>('STRIPE_PUBLISHABLE_KEY'),
    );
    if (this.publishableKey && !/^pk_(test|live)_/.test(this.publishableKey)) {
      throw new Error(
        'STRIPE_PUBLISHABLE_KEY doit commencer par pk_test_ ou pk_live_.',
      );
    }

    this.stripe = new Stripe(secretKey, {
      // Nécessaire pour Ephemeral Keys (PaymentSheet)
      apiVersion: '2024-06-20' as any,
    });
  }

  async onModuleInit() {
    try {
      await this.stripe.balance.retrieve();
      this.logger.log('Stripe : clé secrète acceptée par l’API.');
    } catch (err) {
      if (err instanceof Stripe.errors.StripeAuthenticationError) {
        this.logger.error(
          'STRIPE_SECRET_KEY refusée par Stripe (401). Ouvrez le Dashboard › Clés API, copiez la clé secrète actuelle dans .env et redémarrez.',
        );
      } else {
        this.logger.warn(
          `Vérification Stripe au démarrage : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  getStripe() {
    return this.stripe;
  }

  getPublishableKey() {
    return this.publishableKey;
  }

  /** Requis pour PaymentSheet (clé publique côté app). */
  assertPublishableKey(): void {
    if (!this.publishableKey?.trim()) {
      throw new InternalServerErrorException(
        'STRIPE_PUBLISHABLE_KEY est vide : renseignez-la dans .env (Dashboard Stripe › Clés API).',
      );
    }
  }
}

