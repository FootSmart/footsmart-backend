import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { MatchDto, MatchListResponseDto, MatchEventDto, TeamRefDto } from './dto/match.dto';

/** Supabase select fragment reused across queries */
const MATCH_SELECT = `
  id,
  league_id,
  match_date,
  match_time,
  bet_closes_at,
  matchday,
  venue,
  home_goals,
  away_goals,
  ht_home_goals,
  ht_away_goals,
  ft_home_goals,
  ft_away_goals,
  result,
  status,
  minute,
  referee,
  attendance,
  external_id,
  created_at,
  updated_at,
  home_team:home_team_id ( id, name, short_name, logo ),
  away_team:away_team_id ( id, name, short_name, logo ),
  league:league_id ( id, name, country )
`;

const EVENT_SELECT = `
  id,
  minute,
  extra_minute,
  type,
  detail,
  player,
  player_id,
  assist_player,
  assist_player_id,
  team_id
`;

@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);

  constructor(
    @Inject('SCRAPFOOT_DB_CLIENT')
    private readonly db: SupabaseClient,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private mapTeam(raw: any): TeamRefDto {
    return {
      id: raw?.id,
      name: raw?.name,
      shortName: raw?.short_name,
      logo: raw?.logo,
    };
  }

  private mapEvent(e: any): MatchEventDto {
    return {
      id: e.id,
      minute: e.minute,
      extraMinute: e.extra_minute,
      type: e.type,
      detail: e.detail,
      player: e.player,
      playerId: e.player_id,
      assistPlayer: e.assist_player,
      assistPlayerId: e.assist_player_id,
      teamId: e.team_id,
    };
  }

  private dedupeMatches(rows: any[]): any[] {
    const map = new Map<string, any>();
    for (const row of rows) {
      const id = String(row?.id ?? '');
      if (!id) continue;
      if (!map.has(id)) map.set(id, row);
    }
    return Array.from(map.values());
  }

  private normalizeDateInput(value?: string): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.includes('T')) return trimmed.split('T')[0];
    return trimmed;
  }

  private getTodayDateString(): string {
    return new Date().toISOString().slice(0, 10);
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

  private computeKickoff(matchDateRaw: unknown, matchTimeRaw: unknown): Date | null {
    const kickoff = this.parseDate(matchDateRaw);
    if (!kickoff) return null;

    const matchTime = String(matchTimeRaw ?? '').trim();
    if (!matchTime) return kickoff;

    const parsed = matchTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!parsed) return kickoff;

    const h = Number(parsed[1]);
    const m = Number(parsed[2]);
    const s = Number(parsed[3] ?? '0');
    if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) return kickoff;

    const withTime = new Date(kickoff);
    withTime.setUTCHours(h, m, s, 0);
    return withTime;
  }

  private computeBetClosesAt(row: any): Date | null {
    const explicit = this.parseDate(row?.bet_closes_at);
    if (explicit) return explicit;

    const kickoff = this.computeKickoff(row?.match_date, row?.match_time);
    if (!kickoff) return null;
    return new Date(kickoff.getTime() - 5 * 60 * 1000);
  }

  private getBettingWindow(row: any): {
    betClosesAt: Date | null;
    isBettingOpen: boolean;
    secondsUntilClose: number;
  } {
    const now = new Date();
    const betClosesAt = this.computeBetClosesAt(row);
    if (!betClosesAt) {
      return {
        betClosesAt: null,
        isBettingOpen: row?.status === 'scheduled',
        secondsUntilClose: 0,
      };
    }

    const secondsUntilClose = Math.max(
      0,
      Math.floor((betClosesAt.getTime() - now.getTime()) / 1000),
    );

    return {
      betClosesAt,
      isBettingOpen: row?.status === 'scheduled' && now.getTime() < betClosesAt.getTime(),
      secondsUntilClose,
    };
  }

  private async syncBetClosesAtForScheduledMatches(rows: any[]): Promise<void> {
    const candidates = rows.filter((row) => row?.status === 'scheduled');
    if (candidates.length === 0) return;

    await Promise.all(
      candidates.map(async (row) => {
        const computed = this.computeBetClosesAt(row);
        if (!computed) return;

        const current = this.parseDate(row?.bet_closes_at);
        const currentTime = current?.getTime() ?? null;
        const computedTime = computed.getTime();

        if (currentTime != null && Math.abs(currentTime - computedTime) < 1000) {
          return;
        }

        await this.db
          .from('matches')
          .update({ bet_closes_at: computed.toISOString() })
          .eq('id', row.id);
      }),
    );
  }

  private mapMatch(m: any, events?: any[]): MatchDto {
    const betting = this.getBettingWindow(m);

    return {
      id: m.id,
      leagueId: m.league_id,
      leagueName: m.league?.name ?? m.leagues?.name,
      leagueCountry: m.league?.country ?? m.leagues?.country,
      homeTeam: this.mapTeam(m.home_team),
      awayTeam: this.mapTeam(m.away_team),
      matchDate: m.match_date,
      matchTime: m.match_time,
      matchday: m.matchday,
      venue: m.venue,
      homeGoals: m.home_goals ?? 0,
      awayGoals: m.away_goals ?? 0,
      htHomeGoals: m.ht_home_goals,
      htAwayGoals: m.ht_away_goals,
      result: m.result,
      status: m.status,
      betClosesAt: betting.betClosesAt?.toISOString() ?? null,
      isBettingOpen: betting.isBettingOpen,
      secondsUntilClose: betting.secondsUntilClose,
      minute: m.minute,
      referee: m.referee,
      attendance: m.attendance,
      externalId: m.external_id,
      events: events?.map(this.mapEvent.bind(this)),
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * GET /matches  – paginated, filterable by status / league / date range
   */
  async getAllMatches(opts: {
    status?: string;
    leagueId?: string;
    limit?: number;
    offset?: number;
    from?: string;
    to?: string;
  }): Promise<MatchListResponseDto> {
    const { status, leagueId, limit = 50, offset = 0 } = opts;
    const from = this.normalizeDateInput(opts.from);
    const to = this.normalizeDateInput(opts.to);

    this.logger.debug(`getAllMatches leagueId=${leagueId ?? 'all'}`);

    let query = this.db
      .from('matches')
      .select(MATCH_SELECT, { count: 'exact' })
      .order('match_date', { ascending: false })
      .order('match_time', { ascending: false });

    if (status) query = query.eq('status', status);
    if (leagueId) query = query.eq('league_id', leagueId);
    if (from) query = query.gte('match_date', from);
    if (to) query = query.lte('match_date', to);

    const { data, error, count } = await query;
    if (error) throw new InternalServerErrorException(`Failed to fetch matches: ${error.message}`);

    const beforeDedupe = (data || []).length;
    const unique = this.dedupeMatches(data || []);
    this.logger.debug(`getAllMatches beforeDedupe=${beforeDedupe} afterDedupe=${unique.length}`);

    const paged = unique.slice(offset, offset + limit);

    await this.syncBetClosesAtForScheduledMatches(paged);

    return {
      matches: paged.map((m) => this.mapMatch(m)),
      total: unique.length > 0 ? unique.length : (count ?? 0),
      limit,
      offset,
    };
  }

  /**
   * GET /matches/upcoming – next N fixtures, ordered earliest first
   */
  async getUpcomingMatches(
    limit = 20,
    leagueId?: string,
    nextGameweek = false,
  ): Promise<MatchListResponseDto> {
    const today = this.getTodayDateString();
    this.logger.debug(`getUpcomingMatches leagueId=${leagueId ?? 'all'}`);

    if (!nextGameweek) {
      let query = this.db
        .from('matches')
        .select(MATCH_SELECT, { count: 'exact' })
        .eq('status', 'scheduled')
        .gte('match_date', today)
        .order('match_date', { ascending: true })
        .order('match_time', { ascending: true })
        .limit(limit);

      if (leagueId) query = query.eq('league_id', leagueId);

      const { data, error, count } = await query;
      if (error) throw new InternalServerErrorException(`Failed to fetch upcoming matches: ${error.message}`);

      const beforeDedupe = (data || []).length;
      const unique = this.dedupeMatches(data || []);
      this.logger.debug(`getUpcomingMatches beforeDedupe=${beforeDedupe} afterDedupe=${unique.length}`);

      await this.syncBetClosesAtForScheduledMatches(unique);

      return {
        matches: unique.map((m) => this.mapMatch(m)),
        total: unique.length > 0 ? unique.length : (count ?? 0),
        limit,
        offset: 0,
      };
    }

    let anchorQuery = this.db
      .from('matches')
      .select('match_date, matchday')
      .eq('status', 'scheduled')
      .gte('match_date', today)
      .order('match_date', { ascending: true })
      .order('match_time', { ascending: true })
      .limit(1);

    if (leagueId) anchorQuery = anchorQuery.eq('league_id', leagueId);

    const { data: anchorData, error: anchorError } = await anchorQuery;
    if (anchorError) {
      throw new InternalServerErrorException(
        `Failed to fetch next gameweek anchor: ${anchorError.message}`,
      );
    }

    const anchor = anchorData?.[0];
    if (!anchor) {
      return {
        matches: [],
        total: 0,
        limit,
        offset: 0,
      };
    }

    let query = this.db
      .from('matches')
      .select(MATCH_SELECT, { count: 'exact' })
      .eq('status', 'scheduled')
      .order('match_date', { ascending: true })
      .order('match_time', { ascending: true })
      .limit(limit);

    if (leagueId) query = query.eq('league_id', leagueId);

    const anchorDate = new Date(anchor.match_date);
    const windowEnd = new Date(anchorDate);
    windowEnd.setDate(windowEnd.getDate() + 6);

    // For league-specific queries, matchday is the strongest gameweek signal.
    if (leagueId && anchor.matchday != null) {
      query = query.eq('matchday', anchor.matchday).gte('match_date', today);
    } else {
      query = query
        .gte('match_date', anchorDate.toISOString().slice(0, 10))
        .lte('match_date', windowEnd.toISOString().slice(0, 10));
    }

    const { data, error, count } = await query;
    if (error) throw new InternalServerErrorException(`Failed to fetch upcoming matches: ${error.message}`);

    const beforeDedupe = (data || []).length;
    const unique = this.dedupeMatches(data || []);
    this.logger.debug(`getUpcomingMatches(nextGameweek) beforeDedupe=${beforeDedupe} afterDedupe=${unique.length}`);

    await this.syncBetClosesAtForScheduledMatches(unique);

    return {
      matches: unique.map((m) => this.mapMatch(m)),
      total: unique.length > 0 ? unique.length : (count ?? 0),
      limit,
      offset: 0,
    };
  }

  /**
   * GET /matches/live – currently live matches
   */
  async getLiveMatches(): Promise<MatchListResponseDto> {
    const { data, error, count } = await this.db
      .from('matches')
      .select(MATCH_SELECT, { count: 'exact' })
      .eq('status', 'live')
      .order('match_date', { ascending: true });

    if (error) throw new InternalServerErrorException(`Failed to fetch live matches: ${error.message}`);

    return {
      matches: (data || []).map((m) => this.mapMatch(m)),
      total: count ?? 0,
      limit: 100,
      offset: 0,
    };
  }

  /**
   * GET /matches/:id – single match with all events
   */
  async getMatchById(matchId: string): Promise<MatchDto> {
    const [matchRes, eventsRes] = await Promise.all([
      this.db
        .from('matches')
        .select(MATCH_SELECT)
        .eq('id', matchId)
        .single(),
      this.db
        .from('match_events')
        .select(EVENT_SELECT)
        .eq('match_id', matchId)
        .order('minute', { ascending: true }),
    ]);

    if (matchRes.error || !matchRes.data) {
      throw new NotFoundException(`Match ${matchId} not found`);
    }

    await this.syncBetClosesAtForScheduledMatches([matchRes.data]);

    return this.mapMatch(matchRes.data, eventsRes.data || []);
  }

  /**
   * GET /matches/team/:teamId – recent matches for a team (for form display)
   */
  async getTeamMatches(
    teamId: string,
    limit = 10,
    offset = 0,
    status?: string,
  ): Promise<MatchListResponseDto> {
    this.logger.debug(`getTeamMatches leagueId=team:${teamId}`);

    let homeQ = this.db
      .from('matches')
      .select(MATCH_SELECT, { count: 'exact' })
      .eq('home_team_id', teamId);

    let awayQ = this.db
      .from('matches')
      .select(MATCH_SELECT, { count: 'exact' })
      .eq('away_team_id', teamId);

    if (status) {
      homeQ = homeQ.eq('status', status);
      awayQ = awayQ.eq('status', status);
    }

    const [homeRes, awayRes] = await Promise.all([homeQ, awayQ]);

    if (homeRes.error) throw new InternalServerErrorException(homeRes.error.message);
    if (awayRes.error) throw new InternalServerErrorException(awayRes.error.message);

    const combined = [...(homeRes.data || []), ...(awayRes.data || [])];
    const unique = this.dedupeMatches(combined);
    this.logger.debug(`getTeamMatches beforeDedupe=${combined.length} afterDedupe=${unique.length}`);

    const sorted = unique.sort(
      (a, b) => new Date(b.match_date ?? 0).getTime() - new Date(a.match_date ?? 0).getTime(),
    );
    const paged = sorted.slice(offset, offset + limit);

    await this.syncBetClosesAtForScheduledMatches(paged);

    const total = sorted.length;

    return {
      matches: paged.map((m) => this.mapMatch(m)),
      total,
      limit,
      offset,
    };
  }

  /**
   * GET /matches/team/:teamId/form – last 5 results as W/D/L array
   */
  async getTeamForm(teamId: string, last = 5): Promise<{
    teamId: string;
    form: string[];
    wins: number;
    draws: number;
    losses: number;
    played: number;
    goalsFor: number;
    goalsAgainst: number;
  }> {
    const { matches } = await this.getTeamMatches(teamId, last, 0, 'finished');

    let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
    const form: string[] = [];

    for (const m of matches) {
      const isHome = m.homeTeam.id === teamId;
      const gf = isHome ? m.homeGoals : m.awayGoals;
      const ga = isHome ? m.awayGoals : m.homeGoals;
      goalsFor += gf;
      goalsAgainst += ga;

      if (gf > ga) { wins++; form.push('W'); }
      else if (gf === ga) { draws++; form.push('D'); }
      else { losses++; form.push('L'); }
    }

    return {
      teamId,
      form,
      wins,
      draws,
      losses,
      played: matches.length,
      goalsFor,
      goalsAgainst,
    };
  }

  /**
   * GET /matches/team/:teamId/history – finished matches for a team
   *
   * Uses real DB columns (status, home_goals, away_goals) to determine
   * finished matches. external_id is NEVER parsed to infer result/status.
   */
  async getTeamMatchHistory(
    teamId: string,
    limit = 20,
    offset = 0,
  ): Promise<MatchListResponseDto> {
    this.logger.debug(`getTeamMatchHistory teamId=${teamId}`);

    const [homeRes, awayRes] = await Promise.all([
      this.db
        .from('matches')
        .select(MATCH_SELECT, { count: 'exact' })
        .eq('home_team_id', teamId)
        .or('status.eq.finished,and(home_goals.not.is.null,away_goals.not.is.null)'),
      this.db
        .from('matches')
        .select(MATCH_SELECT, { count: 'exact' })
        .eq('away_team_id', teamId)
        .or('status.eq.finished,and(home_goals.not.is.null,away_goals.not.is.null)'),
    ]);

    if (homeRes.error) throw new InternalServerErrorException(homeRes.error.message);
    if (awayRes.error) throw new InternalServerErrorException(awayRes.error.message);

    const combined = [...(homeRes.data || []), ...(awayRes.data || [])];
    const unique = this.dedupeMatches(combined);
    this.logger.debug(
      `getTeamMatchHistory beforeDedupe=${combined.length} afterDedupe=${unique.length}`,
    );

    const sorted = unique.sort((a, b) => {
      const dateA = new Date(a.match_date ?? 0).getTime();
      const dateB = new Date(b.match_date ?? 0).getTime();
      if (dateB !== dateA) return dateB - dateA;
      // secondary: match_time descending
      return String(b.match_time ?? '').localeCompare(String(a.match_time ?? ''));
    });

    const total = sorted.length;
    const paged = sorted.slice(offset, offset + limit);

    return {
      matches: paged.map((m) => this.mapMatch(m)),
      total,
      limit,
      offset,
    };
  }

  /**
   * GET /matches/team/:teamId/fixtures – next N upcoming matches
   */
  async getTeamFixtures(teamId: string, limit = 5): Promise<MatchDto[]> {
    const today = this.getTodayDateString();

    const [homeRes, awayRes] = await Promise.all([
      this.db
        .from('matches')
        .select(MATCH_SELECT)
        .eq('home_team_id', teamId)
        .eq('status', 'scheduled')
        .gte('match_date', today)
        .order('match_date', { ascending: true })
        .order('match_time', { ascending: true })
        .limit(limit),
      this.db
        .from('matches')
        .select(MATCH_SELECT)
        .eq('away_team_id', teamId)
        .eq('status', 'scheduled')
        .gte('match_date', today)
        .order('match_date', { ascending: true })
        .order('match_time', { ascending: true })
        .limit(limit),
    ]);

    if (homeRes.error) throw new InternalServerErrorException(homeRes.error.message);
    if (awayRes.error) throw new InternalServerErrorException(awayRes.error.message);

    const combined = [...(homeRes.data || []), ...(awayRes.data || [])];
    const unique = this.dedupeMatches(combined);
    this.logger.debug(`getTeamFixtures beforeDedupe=${combined.length} afterDedupe=${unique.length}`);

    const sorted = unique
      .sort((a, b) => new Date(a.match_date ?? 0).getTime() - new Date(b.match_date ?? 0).getTime())
      .slice(0, limit);

    await this.syncBetClosesAtForScheduledMatches(sorted);

    return sorted.map((m) => this.mapMatch(m));
  }
}

