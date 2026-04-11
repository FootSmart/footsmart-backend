import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { Bet } from '../bets/entities/bet.entity';
import { User } from '../auth/users/entities/user.entity';
import { WalletTransaction } from '../wallet/entities/wallet-transaction.entity';
import { ScrapfootModule } from '../scrapfoot/scrapfoot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Bet, User, WalletTransaction]),
    ScrapfootModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
