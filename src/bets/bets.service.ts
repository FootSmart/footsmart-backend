import {
	Injectable,
	Inject,
	NotFoundException,
	InternalServerErrorException,
	BadRequestException,
	ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { DataSource, Repository } from 'typeorm';
import { MatchOddsDto } from './dto/match-odds.dto';
import { PlaceBetDto } from './dto/place-bet.dto';
import { Bet, BetSelection, BetStatus } from './entities/bet.entity';
import { User } from '../auth/users/entities/user.entity';
import {
	WalletTransaction,
	TransactionType,
} from '../wallet/entities/wallet-transaction.entity';

@Injectable()
export class BetsService {
	constructor(
		@Inject('SCRAPFOOT_DB_CLIENT')
		private readonly db: SupabaseClient,
		@InjectRepository(Bet)
		private readonly betRepository: Repository<Bet>,
		private readonly dataSource: DataSource,
	) {}

	private toNumber(value: unknown): number {
		if (typeof value === 'number') return value;
		if (typeof value === 'string') return Number(value);
		return 0;
	}

	private mapBet(bet: Bet) {
		return {
			id: bet.id,
			userId: bet.userId,
			matchId: bet.matchId,
			homeTeam: bet.homeTeam,
			awayTeam: bet.awayTeam,
			selection: bet.selection,
			selectionLabel: bet.selectionLabel,
			stake: this.toNumber(bet.stake),
			odds: this.toNumber(bet.odds),
			potentialPayout: this.toNumber(bet.potentialPayout),
			status: bet.status,
			settledAt: bet.settledAt,
			createdAt: bet.createdAt,
			updatedAt: bet.updatedAt,
		};
	}

	private resolveSelection(
		selection: BetSelection,
		odds: MatchOddsDto,
	): { odds: number; label: string } {
		switch (selection) {
			case BetSelection.HOME:
				return { odds: odds.homeOdds, label: `${odds.homeTeam} Win` };
			case BetSelection.DRAW:
				return { odds: odds.drawOdds, label: 'Draw' };
			case BetSelection.AWAY:
				return { odds: odds.awayOdds, label: `${odds.awayTeam} Win` };
			default:
				throw new BadRequestException('Unsupported bet selection');
		}
	}

	private async ensureMatchBettable(matchId: string): Promise<void> {
		const { data, error } = await this.db
			.from('matches')
			.select('id, status')
			.eq('id', matchId)
			.maybeSingle();

		if (error) {
			throw new InternalServerErrorException(
				`Failed to validate match status: ${error.message}`,
			);
		}

		if (!data) {
			throw new NotFoundException(`Match ${matchId} not found`);
		}

		if (data.status !== 'scheduled') {
			throw new BadRequestException(
				'Bets can only be placed on upcoming (scheduled) matches',
			);
		}
	}

	async getMatchOdds(matchId: string): Promise<MatchOddsDto> {
		const { data, error } = await this.db
			.from('match_odds')
			.select(
				'match_id,home_team,away_team,home_prob,draw_prob,away_prob,home_odds,draw_odds,away_odds',
			)
			.eq('match_id', matchId)
			.limit(1);

		if (error) {
			throw new InternalServerErrorException(
				`Failed to fetch match odds: ${error.message}`,
			);
		}

		if (!data || data.length === 0) {
			throw new NotFoundException(`No odds found for match ${matchId}`);
		}

		const row = data[0];

		return {
			matchId: row.match_id,
			homeTeam: row.home_team,
			awayTeam: row.away_team,
			homeProb: this.toNumber(row.home_prob),
			drawProb: this.toNumber(row.draw_prob),
			awayProb: this.toNumber(row.away_prob),
			homeOdds: this.toNumber(row.home_odds),
			drawOdds: this.toNumber(row.draw_odds),
			awayOdds: this.toNumber(row.away_odds),
		};
	}

	async placeBet(userId: string, placeBetDto: PlaceBetDto) {
		const [matchOdds] = await Promise.all([
			this.getMatchOdds(placeBetDto.matchId),
			this.ensureMatchBettable(placeBetDto.matchId),
		]);

		const stake = Number(Number(placeBetDto.stake).toFixed(2));
		if (!Number.isFinite(stake) || stake <= 0) {
			throw new BadRequestException('Stake must be a positive amount');
		}

		const selected = this.resolveSelection(placeBetDto.selection, matchOdds);
		const potentialPayout = Number((stake * selected.odds).toFixed(2));

		const placed = await this.dataSource.transaction(async (manager) => {
			const user = await manager
				.createQueryBuilder(User, 'user')
				.where('user.id = :userId', { userId })
				.setLock('pessimistic_write')
				.getOne();

			if (!user) {
				throw new NotFoundException('User not found');
			}

			const balanceBefore = this.toNumber(user.balance);
			if (balanceBefore < stake) {
				throw new BadRequestException(
					`Insufficient balance. Current balance: ${balanceBefore.toFixed(2)}, stake: ${stake.toFixed(2)}`,
				);
			}

			const balanceAfter = Number((balanceBefore - stake).toFixed(2));

			user.balance = balanceAfter;
			await manager.save(User, user);

			const walletTransaction = manager.create(WalletTransaction, {
				userId,
				type: TransactionType.BET,
				amount: stake,
			});
			await manager.save(WalletTransaction, walletTransaction);

			const bet = manager.create(Bet, {
				userId,
				matchId: placeBetDto.matchId,
				homeTeam: matchOdds.homeTeam,
				awayTeam: matchOdds.awayTeam,
				selection: placeBetDto.selection,
				selectionLabel: selected.label,
				stake,
				odds: selected.odds,
				potentialPayout,
				status: BetStatus.PENDING,
			});

			await manager.save(Bet, bet);

			return {
				bet,
				wallet: {
					balanceBefore,
					balanceAfter,
					debited: stake,
				},
			};
		});

		return {
			success: true,
			message: 'Bet placed successfully',
			bet: this.mapBet(placed.bet),
			wallet: placed.wallet,
		};
	}

	async getMyBets(
		userId: string,
		limit = 50,
		offset = 0,
		status?: BetStatus,
	) {
		const query = this.betRepository
			.createQueryBuilder('bet')
			.where('bet.user_id = :userId', { userId })
			.orderBy('bet.created_at', 'DESC')
			.take(limit)
			.skip(offset);

		if (status) {
			query.andWhere('bet.status = :status', { status });
		}

		const [bets, total] = await query.getManyAndCount();

		return {
			bets: bets.map((bet) => this.mapBet(bet)),
			total,
			limit,
			offset,
		};
	}

	async getBetById(userId: string, betId: string) {
		const bet = await this.betRepository.findOne({ where: { id: betId } });

		if (!bet) {
			throw new NotFoundException(`Bet ${betId} not found`);
		}

		if (bet.userId !== userId) {
			throw new ForbiddenException('You can only access your own bets');
		}

		return this.mapBet(bet);
	}
}
