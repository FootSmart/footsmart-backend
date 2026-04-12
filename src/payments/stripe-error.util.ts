import { InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';

/** Transforme les erreurs Stripe en messages exploitables côté mobile (sans fuite de secret). */
export function rethrowStripeError(err: unknown): never {
  if (err instanceof Stripe.errors.StripeAuthenticationError) {
    throw new InternalServerErrorException(
      'Clé secrète Stripe invalide ou révoquée. Dashboard Stripe (mode test) › Développeurs › Clés API : '
        + 'révélez ou régénérez la clé secrète, copiez-la dans STRIPE_SECRET_KEY du fichier .env du backend, '
        + 'puis redémarrez le serveur.',
    );
  }
  if (err instanceof Stripe.errors.StripePermissionError) {
    throw new InternalServerErrorException(
      'Stripe : permissions insuffisantes pour cette clé API (utilisez la clé secrète standard sk_test_…, pas une clé limitée sans droits).',
    );
  }
  throw err;
}
