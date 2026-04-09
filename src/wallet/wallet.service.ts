import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WalletTransaction, TransactionType } from './entities/wallet-transaction.entity';
import { User } from '../auth/users/entities/user.entity';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(WalletTransaction)
    private readonly walletTransactionRepository: Repository<WalletTransaction>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get user's current balance
   */
  async getBalance(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      balance: user.balance || 0,
      currency: 'USD',
    };
  }

  /**
   * Get all transactions for a user
   */
  async getTransactions(userId: string, limit = 50, offset = 0) {
    const [transactions, total] = await this.walletTransactionRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return {
      transactions,
      total,
      limit,
      offset,
    };
  }

  /**
   * Deposit money to wallet
   */
  async deposit(userId: string, depositDto: DepositDto) {
    const { amount } = depositDto;

    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    // Use database transaction
    return this.dataSource.transaction(async (manager) => {
      // Lock the user row for update
      const user = await manager
        .createQueryBuilder(User, 'user')
        .where('user.id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const balanceBefore = user.balance || 0;
      const balanceAfter = Number((Number(balanceBefore) + Number(amount)).toFixed(2));

      // Update user balance
      user.balance = balanceAfter;
      await manager.save(User, user);

      // Create transaction record
      const transaction = manager.create(WalletTransaction, {
        userId,
        type: TransactionType.DEPOSIT,
        amount,
      });

      await manager.save(WalletTransaction, transaction);

      return {
        success: true,
        transaction: {
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
          newBalance: balanceAfter,
          createdAt: transaction.createdAt,
        },
      };
    });
  }

  /**
   * Withdraw money from wallet
   */
  async withdraw(userId: string, withdrawDto: WithdrawDto) {
    const { amount } = withdrawDto;

    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    // Use database transaction
    return this.dataSource.transaction(async (manager) => {
      // Lock the user row for update
      const user = await manager
        .createQueryBuilder(User, 'user')
        .where('user.id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const balance = user.balance || 0;

      // Check if user has sufficient funds
      if (Number(balance) < Number(amount)) {
        throw new BadRequestException(
          `Insufficient balance. Current balance: ${balance}, Requested amount: ${amount}`,
        );
      }

      const balanceBefore = balance;
      const balanceAfter = Number((Number(balanceBefore) - Number(amount)).toFixed(2));

      // Update user balance
      user.balance = balanceAfter;
      await manager.save(User, user);

      // Create transaction record
      const transaction = manager.create(WalletTransaction, {
        userId,
        type: TransactionType.WITHDRAW,
        amount,
      });

      await manager.save(WalletTransaction, transaction);

      return {
        success: true,
        transaction: {
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
          newBalance: balanceAfter,
          createdAt: transaction.createdAt,
        },
      };
    });
  }

  /**
   * Place a bet (internal use)
   */
  async placeBet(userId: string, amount: number) {
    if (amount <= 0) {
      throw new BadRequestException('Bet amount must be positive');
    }

    return this.dataSource.transaction(async (manager) => {
      const user = await manager
        .createQueryBuilder(User, 'user')
        .where('user.id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const balance = user.balance || 0;

      if (Number(balance) < Number(amount)) {
        throw new BadRequestException('Insufficient balance for bet');
      }

      const balanceBefore = balance;
      const balanceAfter = Number((Number(balanceBefore) - Number(amount)).toFixed(2));

      user.balance = balanceAfter;
      await manager.save(User, user);

      const transaction = manager.create(WalletTransaction, {
        userId,
        type: TransactionType.BET,
        amount,
      });

      await manager.save(WalletTransaction, transaction);

      return transaction;
    });
  }

  /**
   * Add winnings (internal use)
   */
  async addWinnings(userId: string, amount: number) {
    if (amount <= 0) {
      throw new BadRequestException('Winning amount must be positive');
    }

    return this.dataSource.transaction(async (manager) => {
      const user = await manager
        .createQueryBuilder(User, 'user')
        .where('user.id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const balanceBefore = user.balance || 0;
      const balanceAfter = Number((Number(balanceBefore) + Number(amount)).toFixed(2));

      user.balance = balanceAfter;
      await manager.save(User, user);

      const transaction = manager.create(WalletTransaction, {
        userId,
        type: TransactionType.WIN,
        amount,
      });

      await manager.save(WalletTransaction, transaction);

      return transaction;
    });
  }

  /**
   * Crédite le portefeuille après un paiement Stripe (webhook idempotent).
   */
  async depositFromStripe(
    userId: string,
    amount: number,
    stripePaymentIntentId: string,
  ) {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(WalletTransaction, {
        where: { stripePaymentIntentId },
      });
      if (existing) {
        return {
          success: true,
          duplicate: true,
          transaction: null,
        };
      }

      const user = await manager
        .createQueryBuilder(User, 'user')
        .where('user.id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const balanceBefore = user.balance || 0;
      const balanceAfter = Number(
        (Number(balanceBefore) + Number(amount)).toFixed(2),
      );

      user.balance = balanceAfter;
      await manager.save(User, user);

      const transaction = manager.create(WalletTransaction, {
        userId,
        type: TransactionType.DEPOSIT,
        amount,
        stripePaymentIntentId,
      });

      await manager.save(WalletTransaction, transaction);

      return {
        success: true,
        duplicate: false,
        transaction: {
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
          newBalance: balanceAfter,
          createdAt: transaction.createdAt,
        },
      };
    });
  }
}
