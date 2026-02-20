import {
  Injectable,
  Inject,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { TeamDto, TeamWithPlayersDto, TeamStatsDto } from './dto/team.dto';
import { PlayerDto } from './dto/player.dto';

const TEAM_SELECT = `
  id,
  league_id,
  name,
  short_name,
  logo,
  country,
  stadium,
  stadium_capacity,
  founded_year,
  created_at,
  updated_at,
  leagues ( id, name )
`;

const PLAYER_SELECT = `
  id,
  team_id,
  name,
  short_name,
  nationality,
  position,
  date_of_birth,
  age,
  height_cm,
  weight_kg,
  shirt_number,
  appearances,
  minutes_played,
  goals,
  assists,
  yellow_cards,
  red_cards,
  is_active,
  created_at,
  updated_at
`;

@Injectable()
export class TeamsService {
  constructor(
    @Inject('SCRAPFOOT_DB_CLIENT')
    private readonly db: SupabaseClient,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private mapTeam(t: any): TeamDto {
    return {
      id: t.id,
      leagueId: t.league_id,
      leagueName: t.leagues?.name,
      name: t.name,
      shortName: t.short_name,
      logo: t.logo,
      country: t.country,
      stadium: t.stadium,
      stadiumCapacity: t.stadium_capacity,
      foundedYear: t.founded_year,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  }

  private mapPlayer(p: any): PlayerDto {
    return {
      id: p.id,
      teamId: p.team_id,
      name: p.name,
      shortName: p.short_name,
      nationality: p.nationality,
      position: p.position,
      dateOfBirth: p.date_of_birth,
      age: p.age,
      heightCm: p.height_cm,
      weightKg: p.weight_kg,
      shirtNumber: p.shirt_number,
      appearances: p.appearances ?? 0,
      minutesPlayed: p.minutes_played ?? 0,
      goals: p.goals ?? 0,
      assists: p.assists ?? 0,
      yellowCards: p.yellow_cards ?? 0,
      redCards: p.red_cards ?? 0,
      isActive: p.is_active ?? true,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }

  private mapStats(s: any): TeamStatsDto {
    return {
      id: s.id,
      teamId: s.team_id,
      season: s.season,
      played: s.played ?? 0,
      wins: s.wins ?? 0,
      draws: s.draws ?? 0,
      losses: s.losses ?? 0,
      goalsFor: s.goals_for ?? 0,
      goalsAgainst: s.goals_against ?? 0,
      points: s.points ?? 0,
      cleanSheets: s.clean_sheets ?? 0,
      failedToScore: s.failed_to_score ?? 0,
      currentStreak: s.current_streak,
      longestWinStreak: s.longest_win_streak,
      longestUnbeaten: s.longest_unbeaten,
      longestLosing: s.longest_losing,
      totalYellows: s.total_yellows,
      totalReds: s.total_reds,
      updatedAt: s.updated_at,
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * GET /teams – all teams, optionally filtered by league
   */
  async getAllTeams(leagueId?: string): Promise<TeamDto[]> {
    let query = this.db
      .from('teams')
      .select(TEAM_SELECT)
      .order('name', { ascending: true });

    if (leagueId) query = query.eq('league_id', leagueId);

    const { data, error } = await query;
    if (error) throw new InternalServerErrorException(`Failed to fetch teams: ${error.message}`);

    return (data || []).map(this.mapTeam.bind(this));
  }

  /**
   * GET /teams/:id – single team with full details
   */
  async getTeamById(teamId: string): Promise<TeamDto> {
    const { data, error } = await this.db
      .from('teams')
      .select(TEAM_SELECT)
      .eq('id', teamId)
      .single();

    if (error || !data) throw new NotFoundException(`Team ${teamId} not found`);
    return this.mapTeam(data);
  }

  /**
   * GET /teams/:id/players – all squad members with stats
   */
  async getTeamPlayers(teamId: string, activeOnly = false): Promise<PlayerDto[]> {
    let query = this.db
      .from('players')
      .select(PLAYER_SELECT)
      .eq('team_id', teamId)
      .order('position', { ascending: true });

    if (activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw new InternalServerErrorException(`Failed to fetch players: ${error.message}`);

    return (data || []).map(this.mapPlayer.bind(this));
  }

  /**
   * GET /teams/:id/full – team + squad in one call
   */
  async getTeamWithPlayers(teamId: string): Promise<TeamWithPlayersDto> {
    const [team, players] = await Promise.all([
      this.getTeamById(teamId),
      this.getTeamPlayers(teamId),
    ]);

    return { ...team, players };
  }

  /**
   * GET /teams/:id/stats – season stats from team_stats table
   * If season is omitted returns latest available season
   */
  async getTeamStats(teamId: string, season?: number): Promise<TeamStatsDto> {
    let query = this.db
      .from('team_stats')
      .select('*')
      .eq('team_id', teamId)
      .order('season', { ascending: false });

    if (season) query = query.eq('season', season);

    const { data, error } = await query.limit(1).single();

    if (error || !data) throw new NotFoundException(`No stats found for team ${teamId}`);
    return this.mapStats(data);
  }

  /**
   * GET /teams/league/:leagueId – Top scorers within a league
   */
  async getLeagueTopScorers(leagueId: string, limit = 10): Promise<PlayerDto[]> {
    // Join through teams to filter by league
    const { data, error } = await this.db
      .from('players')
      .select(`${PLAYER_SELECT}, teams!inner ( league_id )`)
      .eq('teams.league_id', leagueId)
      .order('goals', { ascending: false })
      .limit(limit);

    if (error) throw new InternalServerErrorException(`Failed to fetch scorers: ${error.message}`);

    return (data || []).map(this.mapPlayer.bind(this));
  }
}
