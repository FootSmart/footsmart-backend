import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BetsService } from './bets.service';
import { BetsController } from './bets.controller';
import { BetsSettlementService } from './bets-settlement.service';
import { BetsSettlementController } from './bets-settlement.controller';
import { Bet } from './entities/bet.entity';
import { User } from '../auth/users/entities/user.entity';
import { WalletTransaction } from '../wallet/entities/wallet-transaction.entity';
import { ScrapfootModule } from '../scrapfoot/scrapfoot.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Bet, User, WalletTransaction]),
    ScrapfootModule,
  ],
  controllers: [BetsController, BetsSettlementController],
  providers: [BetsService, BetsSettlementService, AdminGuard],
  exports: [BetsService, BetsSettlementService],
})
export class BetsModule {}
