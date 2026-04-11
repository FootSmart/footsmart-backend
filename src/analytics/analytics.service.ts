import {
  Injectable,
  Inject,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { Bet, BetStatus, BetSelection } from '../bets/entities/bet.entity';
import { User } from '../auth/users/entities/user.entity';
import { WalletTransaction } from '../wallet/entities/wallet-transaction.entity';

/** Jointure Supabase : match_odds + matches!inner + leagues!inner
 *  Supabase retourne les relations comme des tableaux (même pour .single()),
 *  on accède donc à [0] sur chaque relation imbriquée.
 */
interface OddsRow {
  match_id: unknown;
  home_team: unknown;
  away_team: unknown;
  home_odds: unknown;
  draw_odds: unknown;
  away_odds: unknown;
  home_prob: unknown;
  draw_prob: unknown;
  away_prob: unknown;
  matches: Array<{
    match_date: unknown;
    status: unknown;
    league_id: unknown;
    leagues: Array<{ name: unknown }>;
  }>;
}

/** Jointure Supabase : matches + home_team + away_team + leagues */
interface MatchRow {
  id: unknown;
  match_date: unknown;
  league_id: unknown;
  home_goals: unknown;
  away_goals: unknown;
  result: unknown;
  status: unknown;
  home_team: Array<{ id: unknown; name: unknown; logo: unknown }>;
  away_team: Array<{ id: unknown; name: unknown; logo: unknown }>;
  leagues: Array<{ id: unknown; name: unknown }>;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject('SCRAPFOOT_DB_CLIENT')
    private readonly db: SupabaseClient,
    @InjectRepository(Bet)
    private readonly betRepository: Repository<Bet>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(WalletTransaction)
    private readonly walletTransactionRepository: Repository<WalletTransaction>,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private toNum(val: unknown): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseFloat(val) || 0;
    return 0;
  }

  private round1(n: number): number {
    return Math.round(n * 10) / 10;
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  // ─── A) User Stats ────────────────────────────────────────────────────────

  async getUserStats(userId: string) {
    // Fetch all bets for this user, newest first
    const bets = await this.betRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const totalBets = bets.length;
    const wins = bets.filter((b) => b.status === BetStatus.WON).length;
    const losses = bets.filter((b) => b.status === BetStatus.LOST).length;
    const pending = bets.filter((b) => b.status === BetStatus.PENDING).length;

    const resolved = wins + losses;
    const winRate = resolved > 0 ? this.round1((wins / resolved) * 100) : 0;

    const totalStaked = this.round2(
      bets.reduce((sum, b) => sum + this.toNum(b.stake), 0),
    );

    const wonBets = bets.filter((b) => b.status === BetStatus.WON);
    const totalReturned = this.round2(
      wonBets.reduce((sum, b) => sum + this.toNum(b.potentialPayout), 0),
    );

    // Profit calculated against stake of resolved bets only
    const resolvedBetsList = bets.filter(
      (b) => b.status === BetStatus.WON || b.status === BetStatus.LOST,
    );
    const resolvedStaked = this.round2(
      resolvedBetsList.reduce((sum, b) => sum + this.toNum(b.stake), 0),
    );
    const profit = this.round2(totalReturned - resolvedStaked);
    const roi =
      resolvedStaked > 0 ? this.round1((profit / resolvedStaked) * 100) : 0;

    const avgOdds =
      totalBets > 0
        ? this.round2(
            bets.reduce((sum, b) => sum + this.toNum(b.odds), 0) / totalBets,
          )
        : 0;

    const avgStake = totalBets > 0 ? this.round2(totalStaked / totalBets) : 0;

    const bestWin =
      wonBets.length > 0
        ? this.round2(
            Math.max(...wonBets.map((b) => this.toNum(b.potentialPayout))),
          )
        : 0;

    // currentStreak: walk resolved bets newest-first, count consecutive same result
    // positive = win streak, negative = loss streak
    let currentStreak = 0;
    if (resolvedBetsList.length > 0) {
      const firstStatus = resolvedBetsList[0].status;
      for (const bet of resolvedBetsList) {
        if (bet.status === firstStatus) {
          currentStreak += firstStatus === BetStatus.WON ? 1 : -1;
        } else {
          break;
        }
      }
    }

    // recentForm: last 10 resolved bets as 'W' or 'L', newest first
    const recentForm = resolvedBetsList
      .slice(0, 10)
      .map((b) => (b.status === BetStatus.WON ? 'W' : 'L'));

    // statsBySelection: home / draw / away breakdown
    const selectionKeys: BetSelection[] = [
      BetSelection.HOME,
      BetSelection.DRAW,
      BetSelection.AWAY,
    ];
    const statsBySelection: Record<
      string,
      { bets: number; wins: number; winRate: number }
    > = {};

    for (const sel of selectionKeys) {
      const selBets = bets.filter((b) => b.selection === sel);
      const selWins = selBets.filter((b) => b.status === BetStatus.WON).length;
      const selResolved =
        selWins + selBets.filter((b) => b.status === BetStatus.LOST).length;

      statsBySelection[sel] = {
        bets: selBets.length,
        wins: selWins,
        winRate:
          selResolved > 0 ? this.round1((selWins / selResolved) * 100) : 0,
      };
    }

    // monthlyStats: last 6 months
    const monthlyStats = this.computeMonthlyStats(bets, 6);

    return {
      totalBets,
      wins,
      losses,
      pending,
      winRate,
      totalStaked,
      totalReturned,
      profit,
      roi,
      avgOdds,
      avgStake,
      bestWin,
      currentStreak,
      recentForm,
      statsBySelection,
      monthlyStats,
    };
  }

  private computeMonthlyStats(
    bets: Bet[],
    months: number,
  ): Array<{ month: string; bets: number; wins: number; profit: number }> {
    const MONTH_LABELS = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const now = new Date();
    const result: Array<{
      month: string;
      bets: number;
      wins: number;
      profit: number;
    }> = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth(); // 0-based
      const label = MONTH_LABELS[month];

      const monthBets = bets.filter((b) => {
        const bd = new Date(b.createdAt);
        return bd.getFullYear() === year && bd.getMonth() === month;
      });

      const monthWons = monthBets.filter((b) => b.status === BetStatus.WON);
      const monthLosts = monthBets.filter((b) => b.status === BetStatus.LOST);

      const returned = monthWons.reduce(
        (s, b) => s + this.toNum(b.potentialPayout),
        0,
      );
      const staked = [...monthWons, ...monthLosts].reduce(
        (s, b) => s + this.toNum(b.stake),
        0,
      );

      result.push({
        month: label,
        bets: monthBets.length,
        wins: monthWons.length,
        profit: this.round2(returned - staked),
      });
    }

    return result;
  }

  // ─── B) Match Insights ───────────────────────────────────────────────────

  async getMatchInsights(opts: { leagueId?: string; limit?: number }) {
    const { leagueId, limit = 30 } = opts;

    let query = this.db
      .from('matches')
      .select(
        `id, status, result, home_goals, away_goals,
         home_team_id, away_team_id, league_id, match_date,
         home_team:home_team_id(id, name, logo),
         away_team:away_team_id(id, name, logo),
         leagues(id, name)`,
      )
      .eq('status', 'finished')
      .order('match_date', { ascending: false })
      .limit(limit);

    if (leagueId) {
      query = query.eq('league_id', leagueId);
    }

    const { data, error } = await query;

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch match insights: ${error.message}`,
      );
    }

    const matches = data || [];
    const total = matches.length;

    const avgGoalsPerMatch =
      total > 0
        ? this.round2(
            matches.reduce(
              (sum, m) =>
                sum + this.toNum(m.home_goals) + this.toNum(m.away_goals),
              0,
            ) / total,
          )
        : 0;

    const homeWins = matches.filter((m) => m.result === 'H').length;
    const draws = matches.filter((m) => m.result === 'D').length;
    const awayWins = matches.filter((m) => m.result === 'A').length;

    const over25 = matches.filter(
      (m) => this.toNum(m.home_goals) + this.toNum(m.away_goals) > 2.5,
    ).length;

    const btts = matches.filter(
      (m) => this.toNum(m.home_goals) > 0 && this.toNum(m.away_goals) > 0,
    ).length;

    const pct = (n: number) => (total > 0 ? this.round1((n / total) * 100) : 0);

    return {
      matches: (matches as unknown as MatchRow[]).map((m) => {
        const ht = Array.isArray(m.home_team) ? m.home_team[0] : null;
        const at = Array.isArray(m.away_team) ? m.away_team[0] : null;
        const lg = Array.isArray(m.leagues) ? m.leagues[0] : null;
        return {
          id: m.id,
          matchDate: m.match_date,
          leagueId: m.league_id,
          leagueName: lg?.name ?? null,
          homeTeam: ht?.name ?? null,
          homeTeamLogo: ht?.logo ?? null,
          awayTeam: at?.name ?? null,
          awayTeamLogo: at?.logo ?? null,
          homeGoals: this.toNum(m.home_goals),
          awayGoals: this.toNum(m.away_goals),
          result: m.result,
          status: m.status,
        };
      }),
      insights: {
        avgGoalsPerMatch,
        homeWinRate: pct(homeWins),
        drawRate: pct(draws),
        awayWinRate: pct(awayWins),
        over25Rate: pct(over25),
        bttsRate: pct(btts),
      },
    };
  }

  // ─── C) Market Movements ─────────────────────────────────────────────────

  async getMarketMovements(leagueId?: string) {
    let query = this.db
      .from('match_odds')
      .select(
        `match_id, home_team, away_team,
         home_odds, draw_odds, away_odds,
         home_prob, draw_prob, away_prob,
         matches!inner(match_date, status, league_id,
           leagues!inner(name))`,
      )
      .eq('matches.status', 'scheduled')
      .order('matches.match_date', { ascending: true })
      .limit(20);

    if (leagueId) {
      query = query.eq('matches.league_id', leagueId);
    }

    const { data, error } = await query;

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch market movements: ${error.message}`,
      );
    }

    return (data || []).map((row) => {
      const homeProb = this.toNum(row.home_prob);
      const awayProb = this.toNum(row.away_prob);

      let valueLabel: string | null = null;
      if (homeProb > 0.6) {
        valueLabel = `${row.home_team} Value Bet`;
      } else if (awayProb > 0.6) {
        valueLabel = `${row.away_team} Value Bet`;
      }

      const typedRow = row as unknown as OddsRow;
      const matchData = Array.isArray(typedRow.matches)
        ? typedRow.matches[0]
        : null;
      const leagueData =
        matchData && Array.isArray(matchData.leagues)
          ? matchData.leagues[0]
          : null;

      return {
        matchId: typedRow.match_id,
        homeTeam: typedRow.home_team,
        awayTeam: typedRow.away_team,
        homeOdds: this.toNum(typedRow.home_odds),
        drawOdds: this.toNum(typedRow.draw_odds),
        awayOdds: this.toNum(typedRow.away_odds),
        homeProb,
        drawProb: this.toNum(typedRow.draw_prob),
        awayProb,
        matchDate: matchData?.match_date ?? null,
        status: matchData?.status ?? null,
        leagueId: matchData?.league_id ?? null,
        leagueName: leagueData?.name ?? null,
        valueLabel,
      };
    });
  }

  // ─── D) Predictions ──────────────────────────────────────────────────────

  async getPredictions(leagueId?: string, limit = 20) {
    let query = this.db
      .from('match_odds')
      .select(
        `match_id, home_team, away_team,
         home_odds, draw_odds, away_odds,
         home_prob, draw_prob, away_prob,
         matches!inner(match_date, status, league_id,
           leagues!inner(name))`,
      )
      .eq('matches.status', 'scheduled')
      .order('matches.match_date', { ascending: true })
      .limit(limit);

    if (leagueId) {
      query = query.eq('matches.league_id', leagueId);
    }

    const { data, error } = await query;

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch predictions: ${error.message}`,
      );
    }

    return (data || []).map((row) => {
      const homeProb = this.toNum(row.home_prob);
      const drawProb = this.toNum(row.draw_prob);
      const awayProb = this.toNum(row.away_prob);

      type Outcome = 'home' | 'draw' | 'away';
      const candidates: Array<{
        outcome: Outcome;
        prob: number;
        label: string;
      }> = [
        { outcome: 'home', prob: homeProb, label: `${row.home_team} Win` },
        { outcome: 'draw', prob: drawProb, label: 'Draw' },
        { outcome: 'away', prob: awayProb, label: `${row.away_team} Win` },
      ];

      const best = candidates.reduce((a, b) => (a.prob >= b.prob ? a : b));
      const confidence = Math.round(best.prob * 100);

      let confidenceLevel: 'high' | 'medium' | 'low';
      if (best.prob > 0.65) {
        confidenceLevel = 'high';
      } else if (best.prob > 0.5) {
        confidenceLevel = 'medium';
      } else {
        confidenceLevel = 'low';
      }

      const typedRow2 = row as unknown as OddsRow;
      const matchData2 = Array.isArray(typedRow2.matches)
        ? typedRow2.matches[0]
        : null;
      const leagueData2 =
        matchData2 && Array.isArray(matchData2.leagues)
          ? matchData2.leagues[0]
          : null;

      return {
        matchId: typedRow2.match_id,
        homeTeam: typedRow2.home_team,
        awayTeam: typedRow2.away_team,
        matchDate: matchData2?.match_date ?? null,
        leagueName: leagueData2?.name ?? null,
        predictedOutcome: best.outcome,
        predictedLabel: best.label,
        confidence,
        homeOdds: this.toNum(typedRow2.home_odds),
        drawOdds: this.toNum(typedRow2.draw_odds),
        awayOdds: this.toNum(typedRow2.away_odds),
        homeProb,
        drawProb,
        awayProb,
        confidenceLevel,
      };
    });
  }
}
