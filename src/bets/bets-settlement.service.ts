import {
  BadRequestException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { Bet, BetSelection, BetStatus } from './entities/bet.entity';
import { User } from '../auth/users/entities/user.entity';
import {
  WalletTransaction,
  TransactionType,
} from '../wallet/entities/wallet-transaction.entity';

/**
 * Résultat brut d'un match depuis Supabase.
 * Le champ `result` peut être :
 *   - 'home'  → l'équipe domicile a gagné
 *   - 'draw'  → match nul
 *   - 'away'  → l'équipe extérieure a gagné
 *   - null    → pas encore de résultat
 */
interface MatchResult {
  id: string;
  status: string;
  result: string | null;
  home_goals: number | null;
  away_goals: number | null;
}

interface SettlementCounts {
  settled: number;
  won: number;
  lost: number;
}

interface MatchSettlementCounts extends SettlementCounts {
  totalPaidOut: number;
  userBalances: Record<string, number>;
}

@Injectable()
export class BetsSettlementService {
  private readonly logger = new Logger(BetsSettlementService.name);

  constructor(
    @Inject('SCRAPFOOT_DB_CLIENT')
    private readonly db: SupabaseClient,

    @InjectRepository(Bet)
    private readonly betRepository: Repository<Bet>,

    private readonly dataSource: DataSource,
  ) {}

  @Cron('0 */5 * * * *') // toutes les 5 minutes
  async runSettlementCron(): Promise<void> {
    this.logger.log('Settlement cron started');
    try {
      const settled = await this.settleAllPendingBets('system-cron');
      if (settled > 0) {
        this.logger.log(`Settled ${settled} bet(s) from cron`);
      }
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Settlement cron failed: ${e.message}`, e.stack);
    }
  }

  async settleAllPendingBets(settledBy = 'manual-api'): Promise<number> {
    const stats = await this.settleAllPendingBetsDetailed(settledBy);
    return stats.settled;
  }

  async settleAllPendingBetsDetailed(
    settledBy = 'manual-api',
  ): Promise<SettlementCounts> {
    const pendingBets = await this.betRepository
      .createQueryBuilder('bet')
      .where('bet.status = :status', { status: BetStatus.PENDING })
      .andWhere('(bet.payoutCredited = :credited OR bet.payoutCredited IS NULL)', {
        credited: false,
      })
      .getMany();

    this.logger.log(`Settlement fetch: total pending bets=${pendingBets.length}`);

    const matchResults = await this.fetchMatchResults(
      pendingBets.map((bet) => bet.matchId),
    );

    const eligibleRows = pendingBets.filter((bet) => {
      const match = matchResults.get(String(bet.matchId));
      this.logger.debug(
        `Settlement candidate bet=${bet.id} match=${match?.id ?? 'n/a'} status=${match?.status ?? 'n/a'}`,
      );

      return match && String(match.status).toLowerCase() === 'finished';
    });

    this.logger.log(`Settlement eligible bets=${eligibleRows.length}`);

    if (eligibleRows.length === 0) return { settled: 0, won: 0, lost: 0 };

    let settledCount = 0;
    let wonCount = 0;
    let lostCount = 0;

    for (const row of eligibleRows) {
      const matchResult = matchResults.get(String(row.matchId));
      const betId = String(row.id);

      if (!matchResult) {
        this.logger.warn(`Match ${row.matchId} not found for bet ${betId}`);
        continue;
      }

      const outcome = this.resolveMatchOutcome(matchResult);
      if (!outcome) {
        this.logger.warn(`Unable to resolve result for match ${matchResult.id}`);
        continue;
      }

      const settled = await this.settleSingleBet(betId, outcome, settledBy);
      if (settled) {
        settledCount++;
        if (row.selection === outcome) wonCount++;
        else lostCount++;
      }
    }

    return { settled: settledCount, won: wonCount, lost: lostCount };
  }

  async settleMatchBets(
    matchId: string,
    settledBy = 'admin-match-finish',
  ): Promise<MatchSettlementCounts> {
    const { data: match, error: matchError } = await this.db
      .from('matches')
      .select('id, status, result, home_goals, away_goals')
      .eq('id', matchId)
      .single();

    if (matchError || !match) {
      throw new NotFoundException(matchError?.message ?? 'Match not found');
    }

    const normalizedStatus = String(match.status ?? '').toLowerCase();
    if (normalizedStatus !== 'finished') {
      throw new BadRequestException('Match must be finished before settlement');
    }

    if (match.home_goals == null || match.away_goals == null) {
      throw new BadRequestException(
        'Finished match must include home_goals and away_goals',
      );
    }

    const outcome = this.resolveMatchOutcome(this.mapSupabaseMatch(match));
    if (!outcome) {
      throw new BadRequestException('Unable to resolve match outcome');
    }

    const pendingBets = await this.betRepository
      .createQueryBuilder('b')
      .where('b.matchId = :matchId', { matchId })
      .andWhere('b.status = :status', { status: BetStatus.PENDING })
      .andWhere('(b.payoutCredited = :credited OR b.payoutCredited IS NULL)', {
        credited: false,
      })
      .getMany();

    this.logger.log(
      `Settle match ${matchId}: total pending bets fetched=${pendingBets.length}`,
    );
    this.logger.debug(
      `Settle match ${matchId}: match_status=${match.status}, home_goals=${match.home_goals}, away_goals=${match.away_goals}`,
    );

    if (pendingBets.length === 0) {
      return {
        settled: 0,
        won: 0,
        lost: 0,
        totalPaidOut: 0,
        userBalances: {},
      };
    }

    let settled = 0;
    let won = 0;
    let lost = 0;
    let totalPaidOut = 0;
    const userBalances: Record<string, number> = {};

    for (const bet of pendingBets) {
      const settleResult = await this.settleSingleBetWithDetails(
        bet.id,
        outcome,
        settledBy,
      );

      if (!settleResult.settled) {
        continue;
      }

      settled += 1;
      if (settleResult.won) {
        won += 1;
      } else {
        lost += 1;
      }

      if (settleResult.payout > 0) {
        totalPaidOut = Number((totalPaidOut + settleResult.payout).toFixed(2));
      }

      if (settleResult.userId && settleResult.balanceAfter != null) {
        userBalances[settleResult.userId] = settleResult.balanceAfter;
      }
    }

    return {
      settled,
      won,
      lost,
      totalPaidOut,
      userBalances,
    };
  }

  private isFinishedMatch(match: MatchResult): boolean {
    return String(match.status).toLowerCase() === 'finished';
  }

  private resolveMatchOutcome(match: MatchResult): BetSelection | null {
    const hg = match.home_goals;
    const ag = match.away_goals;

    if (typeof hg === 'number' && typeof ag === 'number') {
      if (hg > ag) return BetSelection.HOME;
      if (hg < ag) return BetSelection.AWAY;
      return BetSelection.DRAW;
    }

    const normalized = String(match.result ?? '')
      .trim()
      .toLowerCase();

    if (normalized === 'h' || normalized === 'home') return BetSelection.HOME;
    if (normalized === 'd' || normalized === 'draw') return BetSelection.DRAW;
    if (normalized === 'a' || normalized === 'away') return BetSelection.AWAY;
    return null;
  }

  private async settleSingleBet(
    betId: string,
    outcome: BetSelection,
    settledBy: string,
  ): Promise<boolean> {
    const result = await this.settleSingleBetWithDetails(
      betId,
      outcome,
      settledBy,
    );
    return result.settled;
  }

  private async settleSingleBetWithDetails(
    betId: string,
    outcome: BetSelection,
    settledBy: string,
  ): Promise<{
    settled: boolean;
    won: boolean;
    payout: number;
    userId: string | null;
    balanceAfter: number | null;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const lockedBet = await manager
        .createQueryBuilder(Bet, 'bet')
        .where('bet.id = :betId', { betId })
        .setLock('pessimistic_write')
        .getOne();

      if (!lockedBet) {
        return {
          settled: false,
          won: false,
          payout: 0,
          userId: null,
          balanceAfter: null,
        };
      }

      if (
        lockedBet.status !== BetStatus.PENDING ||
        Boolean(lockedBet.payoutCredited)
      ) {
        return {
          settled: false,
          won: false,
          payout: 0,
          userId: null,
          balanceAfter: null,
        };
      }

      const now = new Date();
      const won = lockedBet.selection === outcome;
      let balanceAfter: number | null = null;
      let payout = 0;

      lockedBet.status = won ? BetStatus.WON : BetStatus.LOST;
      lockedBet.result = outcome;
      lockedBet.settledAt = now;
      lockedBet.settledBy = settledBy;
      lockedBet.payoutCredited = won ? true : false;

      if (won) {
        payout = Number(Number(lockedBet.potentialPayout).toFixed(2));
        const user = await manager
          .createQueryBuilder(User, 'user')
          .where('user.id = :userId', { userId: lockedBet.userId })
          .setLock('pessimistic_write')
          .getOne();

        if (!user) {
          throw new Error(`User ${lockedBet.userId} not found`);
        }

        const pointsBefore = Number(user.points ?? 0);
        balanceAfter = Number((pointsBefore + payout).toFixed(2));
        user.points = balanceAfter;
        await manager.save(User, user);

        const transaction = manager.create(WalletTransaction, {
          userId: lockedBet.userId,
          type: TransactionType.WIN,
          amount: payout,
        });
        await manager.save(WalletTransaction, transaction);
      }

      await manager.save(Bet, lockedBet);
      return {
        settled: true,
        won,
        payout,
        userId: lockedBet.userId,
        balanceAfter,
      };
    });
  }

  private mapSupabaseMatch(raw: Record<string, any>): MatchResult {
    return {
      id: String(raw.id),
      status: String(raw.status ?? ''),
      result: raw.result == null ? null : String(raw.result),
      home_goals: raw.home_goals == null ? null : Number(raw.home_goals),
      away_goals: raw.away_goals == null ? null : Number(raw.away_goals),
    };
  }

  private async fetchMatchResults(
    matchIds: string[],
  ): Promise<Map<string, MatchResult>> {
    if (matchIds.length === 0) return new Map();

    const { data, error } = await this.db
      .from('matches')
      .select('id, status, result, home_goals, away_goals')
      .in('id', matchIds);

    if (error) {
      throw new Error(
        `Erreur Supabase lors de la récupération des matchs : ${error.message}`,
      );
    }

    const map = new Map<string, MatchResult>();
    for (const row of data ?? []) {
      const hg = row.home_goals;
      const ag = row.away_goals;

      map.set(row.id as string, {
        id: row.id as string,
        status: row.status as string,
        result: row.result as string | null,
        home_goals: hg == null ? null : Number(hg),
        away_goals: ag == null ? null : Number(ag),
      });
    }

    return map;
  }
}
