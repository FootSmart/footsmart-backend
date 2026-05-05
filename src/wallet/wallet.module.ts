import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../auth/users/users.module';
import { ActiveKycGuard } from '../auth/guards/active-kyc.guard';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { User } from '../auth/users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WalletTransaction, User]),
    AuthModule,
    UsersModule,
  ],
  controllers: [WalletController],
  providers: [WalletService, ActiveKycGuard],
  exports: [WalletService],
})
export class WalletModule {}
