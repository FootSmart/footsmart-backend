import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsController } from './payments.controller';
import { StripeService } from './stripe.service';
import { User } from '../auth/users/entities/user.entity';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([User]), WalletModule],
  controllers: [PaymentsController],
  providers: [StripeService],
})
export class PaymentsModule {}
