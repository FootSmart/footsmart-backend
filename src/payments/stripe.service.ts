import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  // any pour éviter les soucis de typing selon config TS du repo
  private readonly stripe: any;
  private readonly publishableKey: string;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }

    this.publishableKey =
      this.configService.get<string>('STRIPE_PUBLISHABLE_KEY') ?? '';

    this.stripe = new Stripe(secretKey, {
      // Nécessaire pour Ephemeral Keys (PaymentSheet)
      apiVersion: '2024-06-20' as any,
    });
  }

  getStripe() {
    return this.stripe;
  }

  getPublishableKey() {
    return this.publishableKey;
  }
}

