import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { User } from '../auth/users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WalletTransaction, User])],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
