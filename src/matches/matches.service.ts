import {
  Injectable,
  Inject,
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
  leagues ( id, name, country )
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

  private mapMatch(m: any, events?: any[]): MatchDto {
    return {
      id: m.id,
      leagueId: m.league_id,
      leagueName: m.leagues?.name,
      leagueCountry: m.leagues?.country,
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
    const { status, leagueId, limit = 50, offset = 0, from, to } = opts;

    let query = this.db
      .from('matches')
      .select(MATCH_SELECT, { count: 'exact' })
      .order('match_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (leagueId) query = query.eq('league_id', leagueId);
    if (from) query = query.gte('match_date', from);
    if (to) query = query.lte('match_date', to);

    const { data, error, count } = await query;
    if (error) throw new InternalServerErrorException(`Failed to fetch matches: ${error.message}`);

    return {
      matches: (data || []).map((m) => this.mapMatch(m)),
      total: count ?? 0,
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
    const now = new Date().toISOString();

    if (!nextGameweek) {
      let query = this.db
        .from('matches')
        .select(MATCH_SELECT, { count: 'exact' })
        .eq('status', 'scheduled')
        .gte('match_date', now)
        .order('match_date', { ascending: true })
        .limit(limit);

      if (leagueId) query = query.eq('league_id', leagueId);

      const { data, error, count } = await query;
      if (error) throw new InternalServerErrorException(`Failed to fetch upcoming matches: ${error.message}`);

      return {
        matches: (data || []).map((m) => this.mapMatch(m)),
        total: count ?? 0,
        limit,
        offset: 0,
      };
    }

    let anchorQuery = this.db
      .from('matches')
      .select('match_date, matchday')
      .eq('status', 'scheduled')
      .gte('match_date', now)
      .order('match_date', { ascending: true })
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
      .limit(limit);

    if (leagueId) query = query.eq('league_id', leagueId);

    const anchorDate = new Date(anchor.match_date);
    const windowEnd = new Date(anchorDate);
    windowEnd.setDate(windowEnd.getDate() + 6);

    // For league-specific queries, matchday is the strongest gameweek signal.
    if (leagueId && anchor.matchday != null) {
      query = query.eq('matchday', anchor.matchday).gte('match_date', now);
    } else {
      query = query
        .gte('match_date', anchorDate.toISOString())
        .lte('match_date', windowEnd.toISOString());
    }

    const { data, error, count } = await query;
    if (error) throw new InternalServerErrorException(`Failed to fetch upcoming matches: ${error.message}`);

    return {
      matches: (data || []).map((m) => this.mapMatch(m)),
      total: count ?? 0,
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

    const combined = [...(homeRes.data || []), ...(awayRes.data || [])]
      .sort((a, b) => new Date(b.match_date ?? 0).getTime() - new Date(a.match_date ?? 0).getTime())
      .slice(offset, offset + limit);

    const total = (homeRes.count ?? 0) + (awayRes.count ?? 0);

    return {
      matches: combined.map((m) => this.mapMatch(m)),
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
   * GET /matches/team/:teamId/fixtures – next N upcoming matches
   */
  async getTeamFixtures(teamId: string, limit = 5): Promise<MatchDto[]> {
    const now = new Date().toISOString();

    const [homeRes, awayRes] = await Promise.all([
      this.db
        .from('matches')
        .select(MATCH_SELECT)
        .eq('home_team_id', teamId)
        .eq('status', 'scheduled')
        .gte('match_date', now)
        .order('match_date', { ascending: true })
        .limit(limit),
      this.db
        .from('matches')
        .select(MATCH_SELECT)
        .eq('away_team_id', teamId)
        .eq('status', 'scheduled')
        .gte('match_date', now)
        .order('match_date', { ascending: true })
        .limit(limit),
    ]);

    if (homeRes.error) throw new InternalServerErrorException(homeRes.error.message);
    if (awayRes.error) throw new InternalServerErrorException(awayRes.error.message);

    const combined = [...(homeRes.data || []), ...(awayRes.data || [])]
      .sort((a, b) => new Date(a.match_date ?? 0).getTime() - new Date(b.match_date ?? 0).getTime())
      .slice(0, limit);

    return combined.map((m) => this.mapMatch(m));
  }
}

