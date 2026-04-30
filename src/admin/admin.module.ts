import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/users/entities/user.entity';
import { Bet } from '../bets/entities/bet.entity';
import { WalletTransaction } from '../wallet/entities/wallet-transaction.entity';
import { ScrapfootModule } from '../scrapfoot/scrapfoot.module';
import { BetsModule } from '../bets/bets.module';
import { AdminGuard } from '../auth/admin.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Bet, WalletTransaction]),
    ScrapfootModule,
    BetsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
