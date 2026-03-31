import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/users/entities/user.entity';

export enum BetSelection {
  HOME = 'home',
  DRAW = 'draw',
  AWAY = 'away',
}

export enum BetStatus {
  PENDING = 'pending',
  WON = 'won',
  LOST = 'lost',
  CANCELLED = 'cancelled',
}

@Entity('bets')
export class Bet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'match_id' })
  matchId: string;

  @Column({ name: 'home_team' })
  homeTeam: string;

  @Column({ name: 'away_team' })
  awayTeam: string;

  @Column({
    type: 'enum',
    enum: BetSelection,
  })
  selection: BetSelection;

  @Column({ name: 'selection_label' })
  selectionLabel: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  stake: number;

  @Column({ type: 'numeric', precision: 8, scale: 2 })
  odds: number;

  @Column({ name: 'potential_payout', type: 'numeric', precision: 12, scale: 2 })
  potentialPayout: number;

  @Column({
    type: 'enum',
    enum: BetStatus,
    default: BetStatus.PENDING,
  })
  status: BetStatus;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
