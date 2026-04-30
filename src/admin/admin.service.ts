import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../auth/users/entities/user.entity';
import { Bet, BetStatus } from '../bets/entities/bet.entity';
import { BetsSettlementService } from '../bets/bets-settlement.service';
import {
  TransactionType,
  WalletTransaction,
} from '../wallet/entities/wallet-transaction.entity';
import {
  AdminBetsQueryDto,
  AdminMatchesQueryDto,
  AdminUsersQueryDto,
  CreateTestMatchDto,
  FinishMatchDto,
  FullTestScenarioDto,
  ResetUserPointsDto,
  UpdateMatchDto,
  UpdateMatchOddsDto,
  UpdateUserPointsDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject('SCRAPFOOT_DB_CLIENT')
    private readonly db: SupabaseClient,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Bet)
    private readonly betRepository: Repository<Bet>,
    @InjectRepository(WalletTransaction)
    private readonly walletTxRepository: Repository<WalletTransaction>,
    private readonly settlementService: BetsSettlementService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureAdminUser();
  }

  private toNum(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value);
    return 0;
  }

  private parseLimitOffset(limit?: number, offset?: number) {
    return {
      limit: Number(limit ?? 50),
      offset: Number(offset ?? 0),
    };
  }

  private getMatchResult(homeGoals: number, awayGoals: number): 'H' | 'D' | 'A' {
    if (homeGoals > awayGoals) return 'H';
    if (homeGoals < awayGoals) return 'A';
    return 'D';
  }

  async ensureAdminUser() {
    const email = 'admin@admin.com';
    const existing = await this.userRepository.findOne({ where: { email } });
    const passwordHash = await bcrypt.hash('admin1234', 10);

    if (!existing) {
      const created = this.userRepository.create({
        email,
        passwordHash,
        displayName: 'Admin',
        role: 'admin',
        accountStatus: 'active',
        is18Plus: true,
        points: 100000,
        balance: 0,
        kycStatus: 'approved',
      });
      await this.userRepository.save(created);
      this.logger.log('Seeded default admin account');
      return;
    }

    existing.role = 'admin';
    existing.accountStatus = 'active';
    existing.is18Plus = true;
    if (Number(existing.points ?? 0) < 100000) {
      existing.points = 100000;
    }
    existing.passwordHash = passwordHash;
    await this.userRepository.save(existing);
  }

  async getDashboard() {
    const [
      usersCount,
      activeUsersCount,
      adminUsersCount,
      totalBets,
      pendingBets,
      wonBets,
      lostBets,
      totalPointsRaw,
      totalStakedRaw,
      totalPaidOutRaw,
      walletTransactionsCount,
    ] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({ where: { accountStatus: 'active' } }),
      this.userRepository.count({ where: { role: 'admin' } }),
      this.betRepository.count(),
      this.betRepository.count({ where: { status: BetStatus.PENDING } }),
      this.betRepository.count({ where: { status: BetStatus.WON } }),
      this.betRepository.count({ where: { status: BetStatus.LOST } }),
      this.userRepository
        .createQueryBuilder('u')
        .select('COALESCE(SUM(u.points), 0)', 'sum')
        .getRawOne<{ sum: string }>(),
      this.betRepository
        .createQueryBuilder('b')
        .select('COALESCE(SUM(b.stake), 0)', 'sum')
        .getRawOne<{ sum: string }>(),
      this.betRepository
        .createQueryBuilder('b')
        .select('COALESCE(SUM(b.potentialPayout), 0)', 'sum')
        .where('b.status = :status', { status: BetStatus.WON })
        .andWhere('b.payoutCredited = :credited', { credited: true })
        .getRawOne<{ sum: string }>(),
      this.walletTxRepository.count(),
    ]);

    const { data: matchRows, error } = await this.db
      .from('matches')
      .select('status', { count: 'exact' });
    if (error) {
      throw new BadRequestException(error.message);
    }

    const rows = matchRows ?? [];
    const scheduledMatches = rows.filter((m) => m.status === 'scheduled').length;
    const liveMatches = rows.filter((m) => m.status === 'live').length;
    const finishedMatches = rows.filter((m) => m.status === 'finished').length;

    return {
      usersCount,
      activeUsersCount,
      adminUsersCount,
      totalMatches: rows.length,
      scheduledMatches,
      liveMatches,
      finishedMatches,
      totalBets,
      pendingBets,
      wonBets,
      lostBets,
      totalPointsInSystem: this.toNum(totalPointsRaw?.sum),
      totalStaked: this.toNum(totalStakedRaw?.sum),
      totalPaidOut: this.toNum(totalPaidOutRaw?.sum),
      walletTransactionsCount,
    };
  }

  async getUsers(query: AdminUsersQueryDto) {
    const { limit, offset } = this.parseLimitOffset(query.limit, query.offset);
    const qb = this.userRepository.createQueryBuilder('u');

    if (query.search) {
      qb.andWhere('(LOWER(u.email) LIKE :search OR LOWER(u.displayName) LIKE :search)', {
        search: `%${query.search.toLowerCase()}%`,
      });
    }
    if (query.role) {
      qb.andWhere('u.role = :role', { role: query.role });
    }
    if (query.accountStatus) {
      qb.andWhere('u.accountStatus = :accountStatus', {
        accountStatus: query.accountStatus,
      });
    }

    const [users, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        display_name: u.displayName,
        role: u.role,
        points: Number(u.points ?? 0),
        account_status: u.accountStatus,
        is_18_plus: u.is18Plus,
        created_at: u.createdAt,
      })),
      total,
      limit,
      offset,
    };
  }

  async updateUserPoints(userId: string, body: UpdateUserPointsDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.points = Number(body.points);
    await this.userRepository.save(user);
    return { success: true, userId: user.id, points: user.points };
  }

  async updateUserStatus(userId: string, body: UpdateUserStatusDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.accountStatus = body.account_status;
    await this.userRepository.save(user);
    return { success: true, userId: user.id, account_status: user.accountStatus };
  }

  async updateUserRole(userId: string, body: UpdateUserRoleDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.role = body.role;
    await this.userRepository.save(user);
    return { success: true, userId: user.id, role: user.role };
  }

  async createTestMatch(body: CreateTestMatchDto) {
    this.logger.log(`Create test match request: ${JSON.stringify(body)}`);

    const minutesFromNow = Number(body.minutesFromNow ?? 15);
    const closeBefore = Number(body.betCloseMinutesBeforeKickoff ?? 5);
    const homeOdds = Number(body.homeOdds);
    const drawOdds = Number(body.drawOdds);
    const awayOdds = Number(body.awayOdds);

    if (body.homeTeamId === body.awayTeamId) {
      throw new BadRequestException('Home and away teams must be different');
    }

    if (homeOdds <= 0 || drawOdds <= 0 || awayOdds <= 0) {
      throw new BadRequestException('Odds must be positive numbers');
    }

    const kickoff = new Date(Date.now() + minutesFromNow * 60_000);
    const betClosesAt = new Date(kickoff.getTime() - closeBefore * 60_000);
    const matchTime = kickoff.toISOString().slice(11, 19);

    this.logger.log(
      `Kickoff: ${kickoff.toISOString()}, betClosesAt: ${betClosesAt.toISOString()}`,
    );

    const { data: match, error: matchError } = await this.db
      .from('matches')
      .insert({
        league_id: body.leagueId,
        home_team_id: body.homeTeamId,
        away_team_id: body.awayTeamId,
        match_date: kickoff.toISOString(),
        match_time: matchTime,
        status: 'scheduled',
        home_goals: null,
        away_goals: null,
        result: null,
        bet_closes_at: betClosesAt.toISOString(),
        external_id: `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      })
      .select('*')
      .single();

    if (matchError || !match) {
      this.logger.error(`Match insert failed: ${matchError?.message}`);
      throw new BadRequestException(
        matchError?.message ?? 'Failed to create test match',
      );
    }

    this.logger.log(`Test match created: ${match.id}`);

    const { data: odds, error: oddsError } = await this.db
      .from('match_odds')
      .insert({
        match_id: match.id,
        home_team: 'Test Home',
        away_team: 'Test Away',
        home_prob: 45,
        draw_prob: 30,
        away_prob: 25,
        home_odds: homeOdds,
        draw_odds: drawOdds,
        away_odds: awayOdds,
      })
      .select('*')
      .single();

    if (oddsError || !odds) {
      this.logger.error(
        `Odds insert failed for match ${match.id}: ${oddsError?.message}`,
      );
      await this.db.from('matches').delete().eq('id', match.id);
      throw new BadRequestException(
        `Odds insert failed: ${oddsError?.message ?? 'Unknown error'}`,
      );
    }

    this.logger.log(`Odds created for match ${match.id}: ${odds.id}`);

    return {
      success: true,
      match,
      odds,
      message: 'Test match and odds generated successfully',
    };
  }

  async finishMatch(matchId: string, body: FinishMatchDto) {
    const result = this.getMatchResult(body.homeGoals, body.awayGoals);
    const { data, error } = await this.db
      .from('matches')
      .update({
        status: 'finished',
        home_goals: body.homeGoals,
        away_goals: body.awayGoals,
        result,
      })
      .eq('id', matchId)
      .select('*')
      .single();

    if (error || !data) {
      throw new NotFoundException(error?.message ?? 'Match not found');
    }

    const settlement = await this.settlementService.settleMatchBets(
      matchId,
      'admin-finish-match',
    );

    return {
      success: true,
      match: data,
      settlement: {
        settled: settlement.settled,
        won: settlement.won,
        lost: settlement.lost,
        totalPointsPaid: settlement.totalPaidOut,
        userBalances: settlement.userBalances,
      },
    };
  }

  async resetUserPoints(userId: string, body: ResetUserPointsDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const oldPoints = Number(user.points ?? 0);
    user.points = Number(body.points);
    await this.userRepository.save(user);

    // TODO: Add admin_adjustment enum when migration strategy is available.
    const diff = Number((user.points - oldPoints).toFixed(2));
    if (diff !== 0) {
      await this.walletTxRepository.save(
        this.walletTxRepository.create({
          userId: user.id,
          type: diff > 0 ? TransactionType.DEPOSIT : TransactionType.WITHDRAW,
          amount: Math.abs(diff),
        }),
      );
    }

    return { success: true, userId: user.id, points: user.points };
  }

  async settleAll() {
    const beforeWon = await this.betRepository.count({
      where: { status: BetStatus.WON },
    });
    const beforeLost = await this.betRepository.count({
      where: { status: BetStatus.LOST },
    });
    const result = await this.settlementService.settleAllPendingBetsDetailed(
      'admin-panel',
    );
    const afterWon = await this.betRepository.count({
      where: { status: BetStatus.WON },
    });
    const afterLost = await this.betRepository.count({
      where: { status: BetStatus.LOST },
    });

    return {
      success: true,
      settled: result.settled,
      won: Math.max(0, afterWon - beforeWon),
      lost: Math.max(0, afterLost - beforeLost),
      message:
        result.settled > 0
          ? `${result.settled} bet(s) settled successfully.`
          : 'No eligible bets found.',
    };
  }

  async getMatches(query: AdminMatchesQueryDto) {
    const { limit, offset } = this.parseLimitOffset(query.limit, query.offset);
    let req = this.db
      .from('matches')
      .select(
        `
          id, league_id, match_date, match_time, status, home_goals, away_goals, result, bet_closes_at, created_at,
          home_team:home_team_id ( id, name ),
          away_team:away_team_id ( id, name ),
          league:league_id ( id, name )
        `,
        { count: 'exact' },
      )
      .order('match_date', { ascending: false })
      .order('match_time', { ascending: false });

    if (query.status) req = req.eq('status', query.status);
    if (query.leagueId) req = req.eq('league_id', query.leagueId);
    const { data, error, count } = await req.range(offset, offset + limit - 1);
    if (error) throw new BadRequestException(error.message);

    let rows = data ?? [];
    if (query.search) {
      const search = query.search.toLowerCase();
      rows = rows.filter((m: any) =>
        [m.home_team?.[0]?.name ?? m.home_team?.name, m.away_team?.[0]?.name ?? m.away_team?.name, m.league?.[0]?.name ?? m.league?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(search)),
      );
    }

    const ids = rows.map((m) => m.id);
    const oddsMap = new Map<string, any>();
    if (ids.length > 0) {
      const { data: oddsRows } = await this.db
        .from('match_odds')
        .select('match_id, home_odds, draw_odds, away_odds')
        .in('match_id', ids);
      for (const row of oddsRows ?? []) {
        oddsMap.set(row.match_id, row);
      }
    }

    return {
      matches: rows.map((m) => ({
        ...m,
        home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
        away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
        league: Array.isArray(m.league) ? m.league[0] : m.league,
        odds: oddsMap.get(m.id) ?? null,
      })),
      total: count ?? rows.length,
      limit,
      offset,
    };
  }

  async updateMatch(matchId: string, body: UpdateMatchDto) {
    const payload: Record<string, unknown> = {};
    for (const key of [
      'status',
      'match_date',
      'match_time',
      'bet_closes_at',
      'home_goals',
      'away_goals',
      'result',
    ]) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        payload[key] = (body as Record<string, unknown>)[key];
      }
    }

    if (Object.keys(payload).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const { data, error } = await this.db
      .from('matches')
      .update(payload)
      .eq('id', matchId)
      .select('*')
      .single();
    if (error || !data) {
      throw new NotFoundException(error?.message ?? 'Match not found');
    }
    return data;
  }

  async deleteMatch(matchId: string) {
    const { data: match, error: matchError } = await this.db
      .from('matches')
      .select('id, status, match_date, created_at')
      .eq('id', matchId)
      .single();
    if (matchError || !match) {
      throw new NotFoundException(matchError?.message ?? 'Match not found');
    }

    if (String(match.status).toLowerCase() !== 'scheduled') {
      throw new BadRequestException('Only scheduled test matches can be deleted');
    }

    const hasBets = await this.betRepository.count({ where: { matchId } });
    if (hasBets > 0) {
      throw new BadRequestException('Cannot delete a match with bets');
    }

    const { error } = await this.db.from('matches').delete().eq('id', matchId);
    if (error) throw new BadRequestException(error.message);
    return { success: true, matchId };
  }

  async getMatchOdds(matchId: string) {
    const { data, error } = await this.db
      .from('match_odds')
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateMatchOdds(matchId: string, body: UpdateMatchOddsDto) {
    // Check if an odds row already exists for this match
    const { data: existing } = await this.db
      .from('match_odds')
      .select('id')
      .eq('match_id', matchId)
      .maybeSingle();

    let data: any;
    let error: any;

    if (existing) {
      // Row exists → UPDATE by match_id
      ({ data, error } = await this.db
        .from('match_odds')
        .update({
          home_odds: body.homeOdds,
          draw_odds: body.drawOdds,
          away_odds: body.awayOdds,
        })
        .eq('match_id', matchId)
        .select('*')
        .single());
    } else {
      // No row yet → INSERT (no upsert, no onConflict needed)
      ({ data, error } = await this.db
        .from('match_odds')
        .insert({
          match_id: matchId,
          home_odds: body.homeOdds,
          draw_odds: body.drawOdds,
          away_odds: body.awayOdds,
        })
        .select('*')
        .single());
    }

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getBets(query: AdminBetsQueryDto) {
    const { limit, offset } = this.parseLimitOffset(query.limit, query.offset);
    const qb = this.betRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.user', 'u')
      .orderBy('b.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    if (query.status) qb.andWhere('b.status = :status', { status: query.status });
    if (query.userId) qb.andWhere('b.userId = :userId', { userId: query.userId });
    if (query.matchId) qb.andWhere('b.matchId = :matchId', { matchId: query.matchId });

    const [bets, total] = await qb.getManyAndCount();

    return {
      bets: bets.map((bet) => ({
        id: bet.id,
        user_email: bet.user?.email ?? null,
        match: `${bet.homeTeam} vs ${bet.awayTeam}`,
        selection: bet.selection,
        stake: Number(bet.stake),
        odds: Number(bet.odds),
        potential_payout: Number(bet.potentialPayout),
        status: bet.status,
        settled_at: bet.settledAt,
        created_at: bet.createdAt,
        match_id: bet.matchId,
        user_id: bet.userId,
      })),
      total,
      limit,
      offset,
    };
  }

  async runFullTestScenario(body: FullTestScenarioDto) {
    const user = await this.userRepository.findOne({
      where: { email: body.userEmail },
    });
    if (!user) throw new NotFoundException('User not found by email');

    await this.resetUserPoints(user.id, { points: body.points });
    const match = await this.createTestMatch({
      leagueId: body.leagueId,
      homeTeamId: body.homeTeamId,
      awayTeamId: body.awayTeamId,
      minutesFromNow: 15,
      betCloseMinutesBeforeKickoff: 5,
      homeOdds: 2.1,
      drawOdds: 3.0,
      awayOdds: 3.8,
    });

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        points: body.points,
      },
      match,
      instructions: [
        'Open app',
        'Find match',
        'Place bet before bet_closes_at',
        'Come back to admin panel',
        'Finish match',
        'Run settlement',
        'Check user wallet and bet result',
      ],
    };
  }
}
