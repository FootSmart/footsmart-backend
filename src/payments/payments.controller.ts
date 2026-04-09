import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtGuard } from '../auth/jwt.guard';
import { User } from '../auth/users/entities/user.entity';
import { StripeService } from './stripe.service';
import { WalletService } from '../wallet/wallet.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly stripeService: StripeService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly walletService: WalletService,
  ) {}

  @Post('stripe/setup-intent')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Créer un SetupIntent Stripe (PaymentSheet)',
    description:
      "Permet d'ajouter une carte (moyen de paiement) via Stripe PaymentSheet.",
  })
  async createStripeSetupIntent(@Req() req: any) {
    const stripe = this.stripeService.getStripe();
    const userId = req.user.id as string;

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.displayName || undefined,
        metadata: { userId },
      });
      user.stripeCustomerId = customer.id;
      await this.userRepository.save(user);
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: user.stripeCustomerId },
      { apiVersion: '2024-06-20' as any },
    );

    const setupIntent = await stripe.setupIntents.create({
      customer: user.stripeCustomerId,
      automatic_payment_methods: { enabled: true },
      usage: 'off_session',
      metadata: { userId },
    });

    return {
      customerId: user.stripeCustomerId,
      ephemeralKeySecret: ephemeralKey.secret,
      setupIntentClientSecret: setupIntent.client_secret,
      publishableKey: this.stripeService.getPublishableKey(),
    };
  }

  @Post('stripe/deposit-intent')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Créer un PaymentIntent Stripe (dépôt wallet)',
    description:
      'Crée un PaymentIntent pour déposer de l’argent dans le wallet. Le crédit est appliqué via webhook.',
  })
  async createStripeDepositIntent(
    @Req() req: any,
    @Body() body: { amount: number; currency?: string },
  ) {
    const stripe = this.stripeService.getStripe();
    const userId = req.user.id as string;
    const amount = Number(body.amount);
    const currency = (body.currency ?? 'usd').toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount must be a positive number');
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.displayName || undefined,
        metadata: { userId },
      });
      user.stripeCustomerId = customer.id;
      await this.userRepository.save(user);
    }

    // Stripe attend un entier en "minor units" (centimes)
    const amountInMinor = Math.round(amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInMinor,
      currency,
      customer: user.stripeCustomerId,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId,
        kind: 'wallet_deposit',
        amount: amount.toString(),
        currency,
      },
    });

    return {
      paymentIntentClientSecret: paymentIntent.client_secret,
      publishableKey: this.stripeService.getPublishableKey(),
    };
  }

  @Post('stripe/webhook')
  @ApiOperation({
    summary: 'Webhook Stripe (crédit wallet sur payment_intent.succeeded)',
  })
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const stripe = this.stripeService.getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not configured');
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const event = stripe.webhooks.constructEvent(
      req.rawBody as any,
      signature,
      webhookSecret,
    );

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as any;
      const userId = paymentIntent?.metadata?.userId as string | undefined;
      const kind = paymentIntent?.metadata?.kind as string | undefined;

      if (kind === 'wallet_deposit' && userId) {
        const amountInMinor = Number(paymentIntent.amount_received ?? paymentIntent.amount);
        const amount = amountInMinor / 100;
        const paymentIntentId = paymentIntent.id as string;
        await this.walletService.depositFromStripe(userId, amount, paymentIntentId);
      }
    }

    return { received: true };
  }
}

