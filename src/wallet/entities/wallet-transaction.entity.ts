import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/users/entities/user.entity';

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  BET = 'bet',
  WIN = 'win',
}

@Entity('wallet_transactions')
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  type: TransactionType;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  /** Idempotence dépôt Stripe (webhook) */
  @Column({ name: 'stripe_payment_intent_id', nullable: true, unique: true })
  stripePaymentIntentId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
