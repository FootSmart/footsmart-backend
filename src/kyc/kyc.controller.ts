import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { UsersService } from '../auth/users/users.service';
import { StripeService } from '../payments/stripe.service';
import { KycService } from './kyc.service';

@ApiTags('KYC')
@Controller('kyc')
export class KycController {
  constructor(
    private readonly kycService: KycService,
    private readonly usersService: UsersService,
    private readonly stripeService: StripeService,
  ) {}

  @Post('start')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Start KYC verification (Stripe Identity)' })
  async start(@Req() req: any) {
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    return this.kycService.startVerification(user);
  }

  @Get('status')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current KYC status' })
  async status(@Req() req: any) {
    const status = await this.kycService.getStatus(req.user.id);
    if (!status) {
      throw new BadRequestException('User not found');
    }
    return status;
  }

  @Post('skip')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Skip KYC (account remains inactive)' })
  async skip(@Req() req: any) {
    await this.kycService.skipVerification(req.user.id);
    return {
      accountStatus: 'inactive',
      kycStatus: 'not_started',
      message:
        'KYC skipped. Account remains inactive until verification is completed.',
    };
  }

  @Post('webhook/stripe')
  @ApiOperation({ summary: 'Stripe Identity webhook' })
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
    @Body() _body?: any,
  ) {
    const webhookSecret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new BadRequestException(
        'STRIPE_IDENTITY_WEBHOOK_SECRET is not configured',
      );
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const stripe = this.stripeService.getStripe();

    const event = stripe.webhooks.constructEvent(
      req.rawBody as any,
      signature,
      webhookSecret,
    );

    await this.kycService.handleStripeWebhook(event);

    return { received: true };
  }
}
