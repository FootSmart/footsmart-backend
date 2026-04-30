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

	private parseDate(value: unknown): Date | null {
		if (!value) return null;
		if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
		if (typeof value === 'string' || typeof value === 'number') {
			const d = new Date(value);
			return Number.isNaN(d.getTime()) ? null : d;
		}
		return null;
	}

	private computeBetCloseAt(match: {
		match_date?: string | null;
		match_time?: string | null;
		bet_closes_at?: string | null;
	}): Date | null {
		const explicit = this.parseDate(match.bet_closes_at);
		if (explicit) return explicit;

		const kickoffFromDate = this.parseDate(match.match_date);
		if (!kickoffFromDate) return null;

		let kickoff = new Date(kickoffFromDate);
		const rawTime = (match.match_time ?? '').trim();
		if (rawTime) {
			const parsed = rawTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
			if (parsed) {
				const h = Number(parsed[1]);
				const m = Number(parsed[2]);
				const s = Number(parsed[3] ?? '0');
				if (!Number.isNaN(h) && !Number.isNaN(m) && !Number.isNaN(s)) {
					kickoff = new Date(kickoffFromDate);
					kickoff.setUTCHours(h, m, s, 0);
				}
			}
		}

		return new Date(kickoff.getTime() - 5 * 60 * 1000);
	}

	private resolveBettingWindow(match: {
		status?: string | null;
		match_date?: string | null;
		match_time?: string | null;
		bet_closes_at?: string | null;
	}): { betClosesAt: Date | null; isBettingOpen: boolean; secondsUntilClose: number } {
		const now = new Date();
		const betClosesAt = this.computeBetCloseAt(match);
		if (!betClosesAt) {
			return {
				betClosesAt: null,
				isBettingOpen: match.status === 'scheduled',
				secondsUntilClose: 0,
			};
		}

		const secondsUntilClose = Math.max(
			0,
			Math.floor((betClosesAt.getTime() - now.getTime()) / 1000),
		);
		const isBettingOpen =
			match.status === 'scheduled' && now.getTime() < betClosesAt.getTime();

		return { betClosesAt, isBettingOpen, secondsUntilClose };
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
			result: bet.result ?? null,
			payoutCredited: Boolean(bet.payoutCredited),
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

	private async getMatchForBetting(matchId: string): Promise<{
		id: string;
		status: string;
		match_date: string | null;
		match_time: string | null;
		bet_closes_at: string | null;
	}> {
		const { data, error } = await this.db
			.from('matches')
			.select('id, status, match_date, match_time, bet_closes_at')
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

		return {
			id: String(data.id),
			status: String(data.status ?? ''),
			match_date: (data.match_date as string | null) ?? null,
			match_time: (data.match_time as string | null) ?? null,
			bet_closes_at: (data.bet_closes_at as string | null) ?? null,
		};
	}

	private ensureMatchBettable(match: {
		status: string;
		match_date: string | null;
		match_time: string | null;
		bet_closes_at: string | null;
	}): { betClosesAt: Date | null; isBettingOpen: boolean; secondsUntilClose: number } {
		if (match.status !== 'scheduled') {
			throw new BadRequestException(
				'Match not scheduled',
			);
		}

		const window = this.resolveBettingWindow(match);
		if (!window.isBettingOpen) {
			throw new BadRequestException('Betting closed');
		}

		return window;
	}

	async getMatchOdds(matchId: string): Promise<MatchOddsDto> {
		const [match, oddsRes] = await Promise.all([
			this.getMatchForBetting(matchId),
			this.db
			.from('match_odds')
			.select(
				'match_id,home_team,away_team,home_prob,draw_prob,away_prob,home_odds,draw_odds,away_odds',
			)
			.eq('match_id', matchId)
			.limit(1),
		]);

		const { data, error } = oddsRes;

		if (error) {
			throw new InternalServerErrorException(
				`Failed to fetch match odds: ${error.message}`,
			);
		}

		if (!data || data.length === 0) {
			throw new NotFoundException('Odds missing');
		}

		const row = data[0];
		const window = this.resolveBettingWindow(match);

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
			betClosesAt: window.betClosesAt?.toISOString() ?? null,
			isBettingOpen: window.isBettingOpen,
			secondsUntilClose: window.secondsUntilClose,
		};
	}

	async placeBet(userId: string, placeBetDto: PlaceBetDto) {
		const [match, matchOdds] = await Promise.all([
			this.getMatchForBetting(placeBetDto.matchId),
			this.getMatchOdds(placeBetDto.matchId),
		]);
		this.ensureMatchBettable(match);

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

			if (!user.is18Plus) {
				throw new ForbiddenException('You must be 18+ to place bets');
			}

			if (user.accountStatus !== 'active') {
				throw new ForbiddenException('Account status is not active');
			}

			const pointsBefore = this.toNumber(user.points);
			if (pointsBefore < stake) {
				throw new BadRequestException('Insufficient points');
			}

			const pointsAfter = Number((pointsBefore - stake).toFixed(2));

			user.points = pointsAfter;
			await manager.save(User, user);

			const walletTransaction = manager.create(WalletTransaction, {
				userId,
				type: TransactionType.BET,
				amount: -stake,
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
				payoutCredited: false,
			});

			await manager.save(Bet, bet);

			return {
				bet,
				wallet: {
					pointsBefore: Math.trunc(pointsBefore),
					pointsAfter: Math.trunc(pointsAfter),
					debited: Math.trunc(stake),
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
			bets: bets.map((bet) => {
				const mapped = this.mapBet(bet);
				return {
					id: mapped.id,
					homeTeam: mapped.homeTeam,
					awayTeam: mapped.awayTeam,
					selectionLabel: mapped.selectionLabel,
					selection: mapped.selection,
					stake: mapped.stake,
					odds: mapped.odds,
					potentialPayout: mapped.potentialPayout,
					status: mapped.status,
					createdAt: mapped.createdAt,
					settledAt: mapped.settledAt,
					result: mapped.result,
					payoutCredited: mapped.payoutCredited,
					userId: mapped.userId,
					matchId: mapped.matchId,
				};
			}),
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
