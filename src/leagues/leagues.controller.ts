import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { LeaguesService } from './leagues.service';
import { LeagueDto } from './dto/league.dto';
import { LeagueStandingsDto } from './dto/standing.dto';

@Controller('leagues')
@ApiTags('Leagues')
export class LeaguesController {
  constructor(private readonly leaguesService: LeaguesService) {}

  /**
   * Get all available leagues
   * Fetches from scrapfoot database
   */
  @Get()
  @ApiOperation({
    summary: 'Get all leagues',
    description:
      'Fetch all available leagues from scrapfoot database (Flashscore data)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of leagues',
    schema: {
      example: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Premier League',
          country: 'England',
          season: 2025,
          createdAt: '2026-02-20T10:00:00Z',
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          name: 'La Liga',
          country: 'Spain',
          season: 2025,
          createdAt: '2026-02-20T10:00:00Z',
        },
      ],
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async getAllLeagues(): Promise<LeagueDto[]> {
    return this.leaguesService.getAllLeagues();
  }

  /**
   * Get league by ID
   */
  @Get(':id')
  @ApiParam({
    name: 'id',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'League ID (UUID)',
  })
  @ApiOperation({ summary: 'Get league by ID' })
  @ApiResponse({ status: 200, type: LeagueDto })
  @ApiResponse({ status: 404, description: 'League not found' })
  async getLeagueById(@Param('id') leagueId: string): Promise<LeagueDto> {
    return this.leaguesService.getLeagueById(leagueId);
  }

  /**
   * Get league standings by ID
   * Joins standings with teams to return complete standing information
   */
  @Get(':id/standings')
  @ApiParam({
    name: 'id',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'League ID (UUID)',
  })
  @ApiOperation({
    summary: 'Get league standings',
    description:
      'Fetch standings for a specific league with team information, ordered by position',
  })
  @ApiResponse({
    status: 200,
    description: 'League standings with team details',
    schema: {
      example: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Premier League',
        country: 'England',
        season: 2025,
        standings: [
          {
            id: '550e8400-e29b-41d4-a716-446655440100',
            position: 1,
            played: 38,
            wins: 28,
            draws: 3,
            losses: 7,
            points: 87,
            goalDiff: 53,
            season: 2025,
            teamId: '550e8400-e29b-41d4-a716-446655440010',
            teamName: 'Manchester United',
            teamLogo: 'https://example.com/mu-logo.png',
            teamCountry: 'England',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440101',
            position: 2,
            played: 38,
            wins: 27,
            draws: 4,
            losses: 7,
            points: 85,
            goalDiff: 47,
            season: 2025,
            teamId: '550e8400-e29b-41d4-a716-446655440011',
            teamName: 'Liverpool',
            teamLogo: 'https://example.com/liv-logo.png',
            teamCountry: 'England',
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'League not found',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async getLeagueStandings(
    @Param('id') leagueId: string,
  ): Promise<LeagueStandingsDto> {
    return this.leaguesService.getLeagueStandings(leagueId);
  }

  /**
   * Get leagues with team counts
   * Alternative endpoint for quick overview
   */
  @Get('stats/overview')
  @ApiOperation({
    summary: 'Get leagues with stats',
    description: 'Get all leagues with the count of teams in each league',
  })
  @ApiResponse({
    status: 200,
    description: 'List of leagues with team counts',
    schema: {
      example: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Premier League',
          country: 'England',
          season: 2025,
          teamsCount: 20,
        },
      ],
    },
  })
  async getLeaguesWithStats() {
    return this.leaguesService.getLeaguesWithStats();
  }

  /**
   * Get all matches for a league
   * Paginated endpoint for matches
   */
  @Get(':id/matches')
  @ApiParam({
    name: 'id',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'League ID (UUID)',
  })
  @ApiOperation({
    summary: 'Get league matches',
    description: 'Fetch all matches for a specific league with pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'League matches',
    schema: {
      example: {
        matches: [
          {
            id: '550e8400-e29b-41d4-a716-446655440200',
            match_date: '2026-02-21T15:00:00Z',
            status: 'finished',
            minute: 90,
            home_goals: 2,
            away_goals: 1,
            home_team: {
              id: '550e8400-e29b-41d4-a716-446655440010',
              name: 'Manchester United',
              logo: 'https://example.com/mu-logo.png',
            },
            away_team: {
              id: '550e8400-e29b-41d4-a716-446655440011',
              name: 'Liverpool',
              logo: 'https://example.com/liv-logo.png',
            },
          },
        ],
        total: 380,
        limit: 50,
        offset: 0,
      },
    },
  })
  async getLeagueMatches(
    @Param('id') leagueId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ) {
    return this.leaguesService.getLeagueMatches(leagueId, limit, offset);
  }
}
