import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/users/entities/user.entity';
import { UsersModule } from '../auth/users/users.module';
import { StripeService } from '../payments/stripe.service';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([User]), UsersModule],
  controllers: [KycController],
  providers: [KycService, StripeService],
})
export class KycModule {}
