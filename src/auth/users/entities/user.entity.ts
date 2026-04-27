import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  // IMPORTANT: never return this in responses
  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ name: 'display_name', default: '' })
  displayName: string;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string;

  @Column({ nullable: true })
  country?: string;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth?: Date;

  @Column({ name: 'is_18_plus', default: false })
  is18Plus: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  balance: number;

  @Column({ type: 'numeric', precision: 12, scale: 0, default: 0 })
  points: number;

  @Column({ default: 'player' })
  role: string;

  @Column({ name: 'kyc_status', default: 'not_started' })
  kycStatus: string;

  @Column({ name: 'account_status', default: 'active' })
  accountStatus: string;

  @Column({ nullable: true })
  club?: string;

  // Stripe (optionnel) — utilisé pour sauvegarder des moyens de paiement
  @Column({ name: 'stripe_customer_id', nullable: true })
  stripeCustomerId?: string;

  @Column({ name: 'subscriptionActive', default: false })
  subscriptionActive: boolean;

  @Column({ name: 'subscriptionPlan', type: 'text', nullable: true })
  subscriptionPlan?: string | null;

  @Column({ name: 'subscriptionEndsAt', type: 'timestamptz', nullable: true })
  subscriptionEndsAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
