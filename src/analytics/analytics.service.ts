import {
  Injectable,
  Inject,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { Bet, BetStatus, BetSelection } from '../bets/entities/bet.entity';
import { User } from '../auth/users/entities/user.entity';
import { WalletTransaction } from '../wallet/entities/wallet-transaction.entity';

/** Ligne match_odds (sans embed — la FK match_odds→matches peut être absente côté Supabase). */
interface MatchOddsFlat {
  match_id: unknown;
  home_team: unknown;
  away_team: unknown;
  home_odds: unknown;
  draw_odds: unknown;
  away_odds: unknown;
  home_prob: unknown;
  draw_prob: unknown;
  away_prob: unknown;
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
  private readonly logger = new Logger(AnalyticsService.name);

  /** URL de l'API Python ML — définie dans .env via ML_API_URL */
  private readonly mlApiUrl: string;

  constructor(
    @Inject('SCRAPFOOT_DB_CLIENT')
    private readonly db: SupabaseClient,
    @InjectRepository(Bet)
    private readonly betRepository: Repository<Bet>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(WalletTransaction)
    private readonly walletTransactionRepository: Repository<WalletTransaction>,
    private readonly configService: ConfigService,
  ) {
    // Par défaut : http://localhost:8000 (l'API Python tourne en local)
    this.mlApiUrl =
      this.configService.get<string>('ML_API_URL') ?? 'http://localhost:8000';
  }

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

  /** PostgREST embed match_odds→matches exige une FK ; sinon on joint en mémoire. */
  private leagueNameFromMatch(leagues: unknown): string | null {
    if (!leagues) return null;
    if (Array.isArray(leagues)) {
      const first = leagues[0] as { name?: unknown } | undefined;
      return first?.name != null ? String(first.name) : null;
    }
    const o = leagues as { name?: unknown };
    return o.name != null ? String(o.name) : null;
  }

  private async fetchScheduledMatchesOrdered(
    leagueId: string | undefined,
    scanLimit: number,
  ): Promise<
    Array<{
      id: unknown;
      match_date: unknown;
      league_id: unknown;
      leagues: unknown;
    }>
  > {
    let q = this.db
      .from('matches')
      .select('id, match_date, league_id, leagues(name)')
      .eq('status', 'scheduled')
      .order('match_date', { ascending: true })
      .limit(scanLimit);

    if (leagueId) {
      q = q.eq('league_id', leagueId);
    }

    const { data, error } = await q;

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch scheduled matches: ${error.message}`,
      );
    }

    return (data ?? []) as Array<{
      id: unknown;
      match_date: unknown;
      league_id: unknown;
      leagues: unknown;
    }>;
  }

  private async fetchMatchOddsMap(
    matchIds: string[],
  ): Promise<Map<string, MatchOddsFlat>> {
    const map = new Map<string, MatchOddsFlat>();
    if (matchIds.length === 0) return map;

    const { data, error } = await this.db
      .from('match_odds')
      .select(
        `match_id, home_team, away_team,
         home_odds, draw_odds, away_odds,
         home_prob, draw_prob, away_prob`,
      )
      .in('match_id', matchIds);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch match_odds: ${error.message}`,
      );
    }

    for (const row of data ?? []) {
      const r = row as MatchOddsFlat;
      map.set(String(r.match_id), r);
    }
    return map;
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
    const matches = await this.fetchScheduledMatchesOrdered(leagueId, 200);
    const ids = matches.map((m) => String(m.id));
    const oddsMap = await this.fetchMatchOddsMap(ids);

    const rows: Array<{
      odds: MatchOddsFlat;
      match_date: unknown;
      league_id: unknown;
      leagueName: string | null;
    }> = [];

    for (const m of matches) {
      if (rows.length >= 20) break;
      const odds = oddsMap.get(String(m.id));
      if (!odds) continue;
      rows.push({
        odds,
        match_date: m.match_date,
        league_id: m.league_id,
        leagueName: this.leagueNameFromMatch(m.leagues),
      });
    }

    return rows.map(({ odds, match_date, league_id, leagueName }) => {
      const homeProb = this.toNum(odds.home_prob);
      const awayProb = this.toNum(odds.away_prob);

      let valueLabel: string | null = null;
      if (homeProb > 0.6) {
        valueLabel = `${odds.home_team} Value Bet`;
      } else if (awayProb > 0.6) {
        valueLabel = `${odds.away_team} Value Bet`;
      }

      return {
        matchId: odds.match_id,
        homeTeam: odds.home_team,
        awayTeam: odds.away_team,
        homeOdds: this.toNum(odds.home_odds),
        drawOdds: this.toNum(odds.draw_odds),
        awayOdds: this.toNum(odds.away_odds),
        homeProb,
        drawProb: this.toNum(odds.draw_prob),
        awayProb,
        matchDate: match_date ?? null,
        status: 'scheduled',
        leagueId: league_id ?? null,
        leagueName,
        valueLabel,
      };
    });
  }

  // ─── D) Predictions ──────────────────────────────────────────────────────
  //
  // Stratégie :
  //   1. Essayer d'abord l'API Python ML (http://localhost:8000/predictions)
  //   2. Si ML indisponible (timeout, erreur réseau) → fallback Supabase
  //
  // Le modèle ML met à jour match_odds.home_prob/draw_prob/away_prob dans
  // Supabase après chaque run — les deux sources convergent donc vers les
  // mêmes données une fois le ML lancé.
  // ─────────────────────────────────────────────────────────────────────────

  async getPredictions(leagueId?: string, limit = 20) {
    // ── Tentative 1 : API Python ML ────────────────────────────────────────
    try {
      const mlPredictions = await this.fetchFromMlApi(leagueId, limit);
      if (mlPredictions.length > 0) {
        this.logger.log(
          `✅ Prédictions ML chargées depuis Python API (${mlPredictions.length} matchs)`,
        );
        return mlPredictions;
      }
    } catch (mlErr) {
      this.logger.warn(
        `⚠️  API ML indisponible (${this.mlApiUrl}) — fallback Supabase. Raison: ${(mlErr as Error).message}`,
      );
    }

    // ── Tentative 2 : Fallback Supabase (cotes bookmaker) ─────────────────
    this.logger.log(
      '🔄 Calcul des prédictions depuis Supabase (bookmaker odds)...',
    );
    return this.fetchPredictionsFromSupabase(leagueId, limit);
  }

  // ─── Appel à l'API Python ML ─────────────────────────────────────────────

  private async fetchFromMlApi(
    leagueId?: string,
    limit = 20,
  ): Promise<object[]> {
    const params = new URLSearchParams({
      limit: String(limit),
      upsert: 'false', // Ne pas re-upserter depuis NestJS
    });
    if (leagueId) params.set('league_id', leagueId);

    const url = `${this.mlApiUrl}/predictions?${params.toString()}`;

    // Timeout 3 secondes — si le ML est lent, on ne bloque pas l'app
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`ML API répondu ${response.status}`);
    }

    const json = (await response.json()) as {
      predictions?: object[];
      count?: number;
      modelAccuracy?: number;
    };

    interface MlPrediction {
      matchId: string;
      leagueId?: string;
      homeTeam: string;
      awayTeam: string;
      matchDate: string;
      leagueName: string;
      predictedOutcome: string;
      predictedLabel: string;
      confidence: number;
      confidenceLevel: string;
      homeProb: number;
      drawProb: number;
      awayProb: number;
      homeOdds: number;
      drawOdds: number;
      awayOdds: number;
      mlHomeOdds?: number | null;
      mlDrawOdds?: number | null;
      mlAwayOdds?: number | null;
    }

    const predictions = (json.predictions ?? []) as MlPrediction[];

    // Normaliser le format ML → format attendu par Flutter
    return predictions.map((p) => ({
      matchId: p.matchId,
      leagueId: p.leagueId ?? null,
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
      matchDate: p.matchDate,
      leagueName: p.leagueName,
      predictedOutcome: p.predictedOutcome, // 'home' | 'draw' | 'away'
      predictedLabel: p.predictedLabel, // ex: "Man City Win"
      confidence: p.confidence, // 0-100
      confidenceLevel: p.confidenceLevel, // 'high' | 'medium' | 'low'
      homeProb: p.homeProb,
      drawProb: p.drawProb,
      awayProb: p.awayProb,
      homeOdds: p.homeOdds,
      drawOdds: p.drawOdds,
      awayOdds: p.awayOdds,
      // Cotes calculées par le ML (bonus par rapport au fallback Supabase)
      mlHomeOdds: p.mlHomeOdds ?? null,
      mlDrawOdds: p.mlDrawOdds ?? null,
      mlAwayOdds: p.mlAwayOdds ?? null,
      // Indique la source pour le debugging
      source: 'ml',
    }));
  }

  // ─── Fallback : prédictions depuis Supabase (cotes bookmaker) ────────────

  private async fetchPredictionsFromSupabase(
    leagueId?: string,
    limit = 20,
  ): Promise<object[]> {
    const scanLimit = Math.max(limit * 5, 50);
    const matches = await this.fetchScheduledMatchesOrdered(
      leagueId,
      scanLimit,
    );
    const ids = matches.map((m) => String(m.id));
    const oddsMap = await this.fetchMatchOddsMap(ids);

    const merged: Array<{
      odds: MatchOddsFlat;
      match_date: unknown;
      leagueName: string | null;
    }> = [];

    for (const m of matches) {
      if (merged.length >= limit) break;
      const odds = oddsMap.get(String(m.id));
      if (!odds) continue;
      merged.push({
        odds,
        match_date: m.match_date,
        leagueName: this.leagueNameFromMatch(m.leagues),
      });
    }

    return merged.map(({ odds, match_date, leagueName }) => {
      const homeProb = this.toNum(odds.home_prob);
      const drawProb = this.toNum(odds.draw_prob);
      const awayProb = this.toNum(odds.away_prob);

      type Outcome = 'home' | 'draw' | 'away';
      const candidates: Array<{
        outcome: Outcome;
        prob: number;
        label: string;
      }> = [
        { outcome: 'home', prob: homeProb, label: `${odds.home_team} Win` },
        { outcome: 'draw', prob: drawProb, label: 'Draw' },
        { outcome: 'away', prob: awayProb, label: `${odds.away_team} Win` },
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

      return {
        matchId: odds.match_id,
        homeTeam: odds.home_team,
        awayTeam: odds.away_team,
        matchDate: match_date ?? null,
        leagueName,
        predictedOutcome: best.outcome,
        predictedLabel: best.label,
        confidence,
        homeOdds: this.toNum(odds.home_odds),
        drawOdds: this.toNum(odds.draw_odds),
        awayOdds: this.toNum(odds.away_odds),
        homeProb,
        drawProb,
        awayProb,
        confidenceLevel,
        mlHomeOdds: null,
        mlDrawOdds: null,
        mlAwayOdds: null,
        source: 'supabase',
      };
    });
  }

  // ─── E) Match Predictions (Supabase table) ──────────────────────────────

  async getMatchPredictions(params: {
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(Math.max(1, params.pageSize ?? 10), 50);
    const search = params.search?.trim();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.db
      .from('match_predictions')
      .select(
        'id, match_id, home_team, away_team, home_win_prob, draw_prob, away_win_prob, most_likely_score, confidence_score, created_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (search) {
      const term = `%${search}%`;
      query = query.or(`home_team.ilike.${term},away_team.ilike.${term}`);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch match_predictions: ${error.message}`,
      );
    }

    const total = count ?? 0;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

    const rows = (data ?? []) as Array<{
      id: unknown;
      match_id: unknown;
      home_team: unknown;
      away_team: unknown;
      home_win_prob: unknown;
      draw_prob: unknown;
      away_win_prob: unknown;
      most_likely_score: unknown;
      confidence_score: unknown;
      created_at: unknown;
    }>;

    return {
      data: rows.map((r) => ({
        id: r.id,
        matchId: r.match_id,
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        homeWinProb: this.toNum(r.home_win_prob),
        drawProb: this.toNum(r.draw_prob),
        awayWinProb: this.toNum(r.away_win_prob),
        mostLikelyScore: r.most_likely_score,
        confidenceScore: this.toNum(r.confidence_score),
        createdAt: r.created_at,
      })),
      page,
      pageSize,
      total,
      totalPages,
    };
  }
}
