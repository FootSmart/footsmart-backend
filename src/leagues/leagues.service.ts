import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { LeagueDto } from './dto/league.dto';
import { StandingDto, LeagueStandingsDto } from './dto/standing.dto';

@Injectable()
export class LeaguesService {
  constructor(
    @Inject('SCRAPFOOT_DB_CLIENT')
    private readonly scrapfootDb: SupabaseClient,
  ) {}

  /**
   * Get all leagues from scrapfoot database
   * 
   * Query:
   * SELECT id, name, country, season, created_at
   * FROM leagues
   * ORDER BY name ASC
   */
  async getAllLeagues(): Promise<LeagueDto[]> {
    try {
      const { data, error } = await this.scrapfootDb
        .from('leagues')
        .select('id, name, country, season, tier, confederation, created_at, updated_at')
        .order('name', { ascending: true });

      if (error) {
        throw new InternalServerErrorException(
          `Failed to fetch leagues: ${error.message}`,
        );
      }

      return (data || []).map((league: any) => ({
        id: league.id,
        name: league.name,
        country: league.country,
        season: league.season,
        tier: league.tier,
        confederation: league.confederation,
        createdAt: league.created_at,
        updatedAt: league.updated_at,
      }));
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error fetching leagues from database',
      );
    }
  }

  /**
   * Get a single league by ID with full details
   */
  async getLeagueById(leagueId: string): Promise<LeagueDto> {
    const { data, error } = await this.scrapfootDb
      .from('leagues')
      .select('id, name, country, season, tier, confederation, created_at, updated_at')
      .eq('id', leagueId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`League with ID ${leagueId} not found`);
    }

    return {
      id: data.id,
      name: data.name,
      country: data.country,
      season: data.season,
      tier: data.tier,
      confederation: data.confederation,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Get league standings by league ID
   * Joins standings with teams to get complete standing information
   * 
   * Example query:
   * SELECT
   *   s.id,
   *   s.position,
   *   s.played,
   *   s.wins,
   *   s.draws,
   *   s.losses,
   *   s.points,
   *   s.goal_diff,
   *   s.season,
   *   t.id as team_id,
   *   t.name as team_name,
   *   t.logo as team_logo,
   *   t.country as team_country,
   *   l.id, l.name, l.country, l.season
   * FROM standings s
   * INNER JOIN teams t ON s.team_id = t.id
   * INNER JOIN leagues l ON s.league_id = l.id
   * WHERE s.league_id = :leagueId
   * ORDER BY s.position ASC
   */
  async getLeagueStandings(leagueId: string): Promise<LeagueStandingsDto> {
    try {
      // First, verify league exists
      const { data: leagueData, error: leagueError } = await this.scrapfootDb
        .from('leagues')
        .select('id, name, country, season')
        .eq('id', leagueId)
        .single();

      if (leagueError || !leagueData) {
        throw new NotFoundException(
          `League with ID ${leagueId} not found`,
        );
      }

      console.log(`Fetching standings for ${leagueData.name} (Season: ${leagueData.season})`);

      // Fetch standings with team information using join
      // Filter by BOTH league_id AND season to avoid getting historical data
      const { data: standingsData, error: standingsError } = await this.scrapfootDb
        .from('standings')
        .select(
          `
          id,
          position,
          played,
          wins,
          draws,
          losses,
          points,
          goal_diff,
          goals_for,
          goals_against,
          form,
          matchday,
          season,
          teams (
            id,
            name,
            logo,
            country
          )
        `,
        )
        .eq('league_id', leagueId)
        .eq('season', leagueData.season) // Filter by current season
        .order('position', { ascending: true });

      if (standingsError) {
        throw new InternalServerErrorException(
          `Failed to fetch standings: ${standingsError.message}`,
        );
      }

      console.log(`Found ${standingsData?.length || 0} teams in standings`);

      // Transform the response to match StandingDto format
      const standings: StandingDto[] = (standingsData || []).map(
        (standing: any) => ({
          id: standing.id,
          position: standing.position,
          played: standing.played,
          wins: standing.wins,
          draws: standing.draws,
          losses: standing.losses,
          points: standing.points,
          goalDiff: standing.goal_diff,
          goalsFor: standing.goals_for,
          goalsAgainst: standing.goals_against,
          form: standing.form,
          matchday: standing.matchday,
          season: standing.season,
          teamId: standing.teams?.id,
          teamName: standing.teams?.name,
          teamLogo: standing.teams?.logo,
          teamCountry: standing.teams?.country,
        }),
      );

      return {
        id: leagueData.id,
        name: leagueData.name,
        country: leagueData.country,
        season: leagueData.season,
        standings,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error fetching league standings from database',
      );
    }
  }

  /**
   * Get leagues with standings count
   * Useful for listing leagues with team counts
   */
  async getLeaguesWithStats(): Promise<any[]> {
    try {
      const { data, error } = await this.scrapfootDb
        .from('leagues')
        .select('id, name, country, season, standings (count)');

      if (error) {
        throw new InternalServerErrorException(
          `Failed to fetch leagues with stats: ${error.message}`,
        );
      }

      return (
        data?.map((league: any) => ({
          id: league.id,
          name: league.name,
          country: league.country,
          season: league.season,
          teamsCount: league.standings?.length || 0,
        })) || []
      );
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error fetching leagues with stats',
      );
    }
  }

  /**
   * Get all matches for a league
   * Joins with teams to get team names
   */
  async getLeagueMatches(leagueId: string, limit = 50, offset = 0): Promise<any> {
    try {
      const { data, error, count } = await this.scrapfootDb
        .from('matches')
        .select(
          `
          id,
          match_date,
          status,
          minute,
          home_goals,
          away_goals,
          home_team:home_team_id (id, name, logo),
          away_team:away_team_id (id, name, logo)
        `,
          { count: 'exact' },
        )
        .eq('league_id', leagueId)
        .order('match_date', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        throw new InternalServerErrorException(
          `Failed to fetch matches: ${error.message}`,
        );
      }

      return {
        matches: data || [],
        total: count || 0,
        limit,
        offset,
      };
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error fetching league matches from database',
      );
    }
  }
}
