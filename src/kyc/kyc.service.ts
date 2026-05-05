import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripeService } from '../payments/stripe.service';
import { User } from '../auth/users/entities/user.entity';

@Injectable()
export class KycService {
  constructor(
    private readonly stripeService: StripeService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async startVerification(user: User) {
    const stripe = this.stripeService.getStripe();

    const session = await stripe.identity.verificationSessions.create({
      type: 'document',
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
      },
      options: {
        document: {
          require_matching_selfie: true,
        },
      },
    });

    await this.userRepository.update(
      { id: user.id },
      {
        accountStatus: 'inactive',
        kycStatus: 'pending',
        kycProvider: 'stripe',
        kycReferenceId: session.id,
        kycRejectionReason: null,
      },
    );

    return {
      clientSecret: session.client_secret ?? null,
      url: session.url ?? null,
    };
  }

  async skipVerification(userId: string) {
    await this.userRepository.update(
      { id: userId },
      {
        accountStatus: 'inactive',
        kycStatus: 'not_started',
      },
    );
  }

  async getStatus(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return null;

    return {
      accountStatus: user.accountStatus,
      kycStatus: user.kycStatus,
      provider: user.kycProvider ?? null,
      verifiedAt: user.kycVerifiedAt ?? null,
      rejectionReason: user.kycRejectionReason ?? null,
    };
  }

  private extractUserIdFromSession(session: any): string | null {
    return (
      session?.client_reference_id ||
      session?.metadata?.userId ||
      session?.metadata?.user_id ||
      null
    );
  }

  async handleStripeWebhook(event: any): Promise<void> {
    const session = event?.data?.object;
    if (!session) return;

    const userId = this.extractUserIdFromSession(session);
    if (!userId) return;

    if (event.type === 'identity.verification_session.verified') {
      await this.userRepository.update(
        { id: userId },
        {
          kycStatus: 'approved',
          accountStatus: 'active',
          kycProvider: 'stripe',
          kycReferenceId: session?.id ?? null,
          kycVerifiedAt: new Date(),
          kycRejectionReason: null,
        },
      );
      return;
    }

    if (event.type === 'identity.verification_session.requires_input') {
      const reason = session?.last_error?.reason || session?.last_error?.code;
      await this.userRepository.update(
        { id: userId },
        {
          kycStatus: 'rejected',
          accountStatus: 'inactive',
          kycProvider: 'stripe',
          kycReferenceId: session?.id ?? null,
          kycRejectionReason: reason ? String(reason) : null,
        },
      );
      return;
    }

    if (event.type === 'identity.verification_session.processing') {
      await this.userRepository.update(
        { id: userId },
        {
          kycStatus: 'pending',
          accountStatus: 'inactive',
          kycProvider: 'stripe',
          kycReferenceId: session?.id ?? null,
        },
      );
      return;
    }

    if (String(event.type).includes('review')) {
      await this.userRepository.update(
        { id: userId },
        {
          kycStatus: 'manual_review',
          accountStatus: 'inactive',
          kycProvider: 'stripe',
          kycReferenceId: session?.id ?? null,
        },
      );
    }
  }
}
