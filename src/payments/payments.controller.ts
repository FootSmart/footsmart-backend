import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtGuard } from '../auth/jwt.guard';
import { User } from '../auth/users/entities/user.entity';
import { rethrowStripeError } from './stripe-error.util';
import { StripeService } from './stripe.service';
import { WalletService } from '../wallet/wallet.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly stripeService: StripeService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly walletService: WalletService,
    private readonly configService: ConfigService,
  ) {}

  /** URL publique du backend (redirections Stripe Checkout). Émulateur : http://10.0.2.2:PORT — téléphone réel : IP LAN du PC. */
  private appBaseUrl(): string {
    return (
      this.configService.get<string>('PUBLIC_BASE_URL') ?? 'http://localhost:3008'
    ).replace(/\/$/, '');
  }

  /**
   * Garantit un Customer Stripe valide pour les clés API actuelles.
   * Si l’ID en base vient d’un ancien compte / clés rotées → « No such customer » → on recrée.
   */
  private async ensureStripeCustomer(
    user: User,
    userId: string,
  ): Promise<User> {
    const stripe = this.stripeService.getStripe();

    const createAndSave = async () => {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.displayName || undefined,
        metadata: { userId },
      });
      user.stripeCustomerId = customer.id;
      await this.userRepository.save(user);
      return user;
    };

    if (!user.stripeCustomerId) {
      return createAndSave();
    }

    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
      return user;
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const missing =
        e?.code === 'resource_missing' ||
        (typeof e?.message === 'string' &&
          e.message.toLowerCase().includes('no such customer'));
      if (!missing) {
        throw err;
      }
      user.stripeCustomerId = undefined;
      await this.userRepository.save(user);
      return createAndSave();
    }
  }

  /** Après setup_intent.succeeded : lie la carte au Customer Stripe (évite elements/sessions côté mobile). */
  private async attachSetupIntentPaymentMethod(
    userId: string,
    paymentMethodId: string | undefined,
  ): Promise<void> {
    if (!paymentMethodId || typeof paymentMethodId !== 'string') {
      return;
    }
    const stripe = this.stripeService.getStripe();
    let user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      return;
    }
    user = await this.ensureStripeCustomer(user, userId);
    try {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: user.stripeCustomerId!,
      });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const msg = (e?.message ?? '').toLowerCase();
      if (
        e?.code === 'resource_already_exists' ||
        msg.includes('already been attached') ||
        msg.includes('already attached')
      ) {
        return;
      }
      throw err;
    }
  }

  @Get('stripe/payment-methods')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Lister les cartes Stripe du client',
    description:
      'Retourne les cartes enregistrées sur le customer Stripe (last4, marque, expiration).',
  })
  async listStripePaymentMethods(@Req() req: any) {
    try {
      const stripe = this.stripeService.getStripe();
      const userId = req.user.id as string;

      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return { paymentMethods: [] as unknown[] };
      }

      const u = await this.ensureStripeCustomer(user, userId);

      const list = await stripe.paymentMethods.list({
        customer: u.stripeCustomerId,
        type: 'card',
      });

      const paymentMethods = list.data.map((pm: any, index: number) => {
        const card = pm.card;
        const brandRaw = (card?.brand as string | undefined) ?? 'card';
        const brand =
          brandRaw.length > 0
            ? brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1)
            : 'Card';

        return {
          id: pm.id as string,
          brand,
          last4: (card?.last4 as string) ?? '',
          expMonth: card?.exp_month as number | undefined,
          expYear: card?.exp_year as number | undefined,
          holder: (pm.billing_details?.name as string | undefined) ?? '',
          isDefault: index === 0,
        };
      });

      return { paymentMethods };
    } catch (err) {
      rethrowStripeError(err);
    }
  }

  /**
   * Extrait l’id `seti_…` depuis le client_secret renvoyé par Stripe.
   */
  private setupIntentIdFromClientSecret(clientSecret: string): string | null {
    const idx = clientSecret.indexOf('_secret_');
    if (idx <= 0) {
      return null;
    }
    return clientSecret.slice(0, idx);
  }

  /**
   * Après succès du PaymentSheet (ajout carte) : rattache la PM au Customer sans attendre le webhook.
   * Idempotent avec le webhook `setup_intent.succeeded`.
   */
  @Post('stripe/complete-setup')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Finaliser l’ajout de carte (attache la PM au Customer)',
    description:
      'À appeler après présentation réussie du PaymentSheet. Utile si le webhook est lent ou absent en dev.',
  })
  async completeStripeSetup(
    @Req() req: any,
    @Body() body: { setupIntentClientSecret: string },
  ) {
    try {
      const stripe = this.stripeService.getStripe();
      const userId = req.user.id as string;
      const secret = body?.setupIntentClientSecret?.trim();
      if (!secret) {
        throw new BadRequestException('setupIntentClientSecret is required');
      }
      const siId = this.setupIntentIdFromClientSecret(secret);
      if (!siId?.startsWith('seti_')) {
        throw new BadRequestException('Invalid setupIntentClientSecret');
      }
      const si = await stripe.setupIntents.retrieve(siId);
      const metaUid = si.metadata?.userId as string | undefined;
      if (metaUid !== userId) {
        throw new BadRequestException('SetupIntent does not belong to this user');
      }
      const pmId = si.payment_method as string | undefined;
      await this.attachSetupIntentPaymentMethod(userId, pmId);
      return { ok: true as const };
    } catch (err) {
      rethrowStripeError(err);
    }
  }

  @Post('stripe/setup-intent')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Créer un SetupIntent Stripe (PaymentSheet)',
    description:
      "Permet d'ajouter une carte (moyen de paiement) via Stripe PaymentSheet.",
  })
  async createStripeSetupIntent(@Req() req: any) {
    try {
      const stripe = this.stripeService.getStripe();
      const userId = req.user.id as string;

      let user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) throw new BadRequestException('User not found');

      user = await this.ensureStripeCustomer(user, userId);

      this.stripeService.assertPublishableKey();

      // SetupIntent sans `customer` : le PaymentSheet mobile n’appelle pas GET …/elements/sessions
      // (souvent bloqué sur émulateur / réseau). La carte est rattachée au Customer dans le webhook
      // `setup_intent.succeeded` (voir attachSetupIntentPaymentMethod).
      const setupIntent = await stripe.setupIntents.create({
        automatic_payment_methods: { enabled: true },
        usage: 'off_session',
        metadata: { userId, flow: 'add_card' },
      });

      return {
        setupIntentClientSecret: setupIntent.client_secret,
        publishableKey: this.stripeService.getPublishableKey(),
      };
    } catch (err) {
      rethrowStripeError(err);
    }
  }

  /**
   * Stripe Checkout en mode « setup » : la saisie carte se fait sur checkout.stripe.com
   * (contourne les soucis DNS / api.stripe.com depuis le SDK natif sur certains appareils).
   */
  @Post('stripe/checkout-setup')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Session Checkout Stripe (enregistrer une carte)',
    description:
      'Retourne une URL https://checkout.stripe.com/... à ouvrir dans un WebView ou le navigateur.',
  })
  async createCheckoutSetupSession(@Req() req: any) {
    try {
      const stripe = this.stripeService.getStripe();
      const userId = req.user.id as string;

      let user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) throw new BadRequestException('User not found');

      user = await this.ensureStripeCustomer(user, userId);
      this.stripeService.assertPublishableKey();

      const base = this.appBaseUrl();
      const successUrl = `${base}/api/payments/stripe/hosted-setup-return?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${base}/api/payments/stripe/hosted-setup-return?canceled=1`;

      const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        currency: 'usd',
        customer: user.stripeCustomerId!,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId, flow: 'hosted_add_card' },
        payment_method_types: ['card'],
      });

      if (!session.url) {
        throw new BadRequestException('Stripe Checkout URL indisponible');
      }

      return {
        url: session.url,
        publishableKey: this.stripeService.getPublishableKey(),
      };
    } catch (err) {
      rethrowStripeError(err);
    }
  }

  /**
   * Dépôt wallet via Stripe Checkout : le client choisit une carte déjà enregistrée
   * (ou en saisit une nouvelle) sur checkout.stripe.com.
   */
  @Post('stripe/checkout-deposit')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Session Checkout Stripe (dépôt wallet)',
    description:
      'Montant saisi dans l’app ; paiement sur la page Stripe avec moyens enregistrés du Customer.',
  })
  async createCheckoutDepositSession(
    @Req() req: any,
    @Body() body: { amount: number; currency?: string },
  ) {
    try {
      const stripe = this.stripeService.getStripe();
      const userId = req.user.id as string;
      const amount = Number(body.amount);
      const currency = (body.currency ?? 'usd').toLowerCase();

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('amount must be a positive number');
      }

      let user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) throw new BadRequestException('User not found');

      user = await this.ensureStripeCustomer(user, userId);
      this.stripeService.assertPublishableKey();

      const amountInMinor = Math.round(amount * 100);
      if (amountInMinor < 50) {
        throw new BadRequestException('Montant minimum 0,50 (50 centimes)');
      }

      const base = this.appBaseUrl();
      const successUrl = `${base}/api/payments/stripe/hosted-deposit-return?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${base}/api/payments/stripe/hosted-deposit-return?canceled=1`;

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: user.stripeCustomerId!,
        currency,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: amountInMinor,
              product_data: {
                name: 'Dépôt wallet FootSmart',
                description: `Crédit portefeuille — ${amount.toFixed(2)} ${currency.toUpperCase()}`,
              },
            },
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId,
          kind: 'wallet_deposit_checkout',
          amount: amount.toString(),
          currency,
        },
        payment_intent_data: {
          metadata: {
            userId,
            kind: 'wallet_deposit',
            amount: amount.toString(),
            currency,
          },
        },
      });

      if (!session.url) {
        throw new BadRequestException('Stripe Checkout URL indisponible');
      }

      return {
        url: session.url,
        publishableKey: this.stripeService.getPublishableKey(),
      };
    } catch (err) {
      rethrowStripeError(err);
    }
  }

  /**
   * Après retour Checkout : crédite le wallet via l’API Stripe (même logique que le webhook).
   * Indispensable si le webhook Stripe n’atteint pas le serveur (ex. dev local).
   */
  @Post('stripe/complete-checkout-deposit')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Finaliser un dépôt Checkout (session Stripe)',
    description:
      'À appeler avec le session_id retourné par la redirection success_url ; idempotent avec le webhook.',
  })
  async completeCheckoutDeposit(
    @Req() req: any,
    @Body() body: { sessionId: string },
  ) {
    try {
      const stripe = this.stripeService.getStripe();
      const userId = req.user.id as string;
      const sessionId = (body.sessionId ?? '').trim();
      if (!sessionId) {
        throw new BadRequestException('sessionId is required');
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent'],
      });

      const md = session.metadata || {};
      if (md.kind !== 'wallet_deposit_checkout' || !md.userId) {
        throw new BadRequestException('Invalid checkout session');
      }
      if (md.userId !== userId) {
        throw new ForbiddenException('Session does not belong to this user');
      }

      if (session.payment_status !== 'paid') {
        throw new BadRequestException('Payment not completed');
      }

      const piRaw = session.payment_intent;
      const paymentIntentId =
        typeof piRaw === 'string' ? piRaw : (piRaw as { id?: string })?.id;
      const total = Number(session.amount_total ?? 0);
      const amount = total / 100;

      if (!paymentIntentId || amount <= 0) {
        throw new BadRequestException('Invalid payment session');
      }

      const result = await this.walletService.depositFromStripe(
        userId,
        amount,
        paymentIntentId,
      );

      return {
        success: true,
        duplicate: result.duplicate,
        newBalance: result.transaction?.newBalance,
      };
    } catch (err) {
      rethrowStripeError(err);
    }
  }

  @Get('stripe/hosted-deposit-return')
  @ApiOperation({ summary: 'Retour HTTP après Checkout (dépôt wallet)' })
  hostedDepositReturn(
    @Query('canceled') canceled: string | undefined,
    @Query('session_id') _sessionId: string | undefined,
    @Res() res: Response,
  ) {
    if (canceled === '1') {
      res
        .status(200)
        .type('html')
        .send(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="font-family:system-ui;padding:2rem;text-align:center"><h2>Paiement annulé</h2><p>Vous pouvez fermer cette page.</p></body></html>',
        );
      return;
    }
    res
      .status(200)
      .type('html')
      .send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="font-family:system-ui;padding:2rem;text-align:center"><h2>Paiement réussi</h2><p>Retournez à l’application pour voir votre solde.</p></body></html>',
      );
  }

  /** Page de retour après Checkout (ouverte par Stripe en redirection). */
  @Get('stripe/hosted-setup-return')
  @ApiOperation({ summary: 'Retour HTTP après Checkout (setup carte)' })
  hostedSetupReturn(
    @Query('canceled') canceled: string | undefined,
    @Query('session_id') _sessionId: string | undefined,
    @Res() res: Response,
  ) {
    if (canceled === '1') {
      res
        .status(200)
        .type('html')
        .send(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="font-family:system-ui;padding:2rem;text-align:center"><h2>Annulé</h2><p>Vous pouvez fermer cette page.</p></body></html>',
        );
      return;
    }
    res
      .status(200)
      .type('html')
      .send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="font-family:system-ui;padding:2rem;text-align:center"><h2>Carte enregistrée</h2><p>Vous pouvez revenir à l’application.</p></body></html>',
      );
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
    try {
      const stripe = this.stripeService.getStripe();
      const userId = req.user.id as string;
      const amount = Number(body.amount);
      const currency = (body.currency ?? 'usd').toLowerCase();

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('amount must be a positive number');
      }

      let user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) throw new BadRequestException('User not found');

      user = await this.ensureStripeCustomer(user, userId);

      this.stripeService.assertPublishableKey();

      // Pas de `customer` sur le PI ni Customer Session : évite GET …/elements/sessions sur le mobile.
      // Le crédit wallet reste lié à l’utilisateur via metadata.userId (webhook).

      // Stripe attend un entier en "minor units" (centimes)
      const amountInMinor = Math.round(amount * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInMinor,
        currency,
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
    } catch (err) {
      rethrowStripeError(err);
    }
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const md = session.metadata || {};
      if (md.kind === 'wallet_deposit_checkout' && md.userId) {
        const piRaw = session.payment_intent;
        const paymentIntentId =
          typeof piRaw === 'string' ? piRaw : (piRaw?.id as string | undefined);
        const total = Number(session.amount_total ?? 0);
        const amount = total / 100;
        const userId = md.userId as string;
        if (paymentIntentId && amount > 0 && userId) {
          await this.walletService.depositFromStripe(userId, amount, paymentIntentId);
        }
      }
    }

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

    if (event.type === 'setup_intent.succeeded') {
      const setupIntent = event.data.object as any;
      const userId = setupIntent?.metadata?.userId as string | undefined;
      const flow = setupIntent?.metadata?.flow as string | undefined;
      const pmId = setupIntent?.payment_method as string | undefined;

      if (userId && flow === 'add_card' && pmId) {
        await this.attachSetupIntentPaymentMethod(userId, pmId);
      }
    }

    return { received: true };
  }
}

