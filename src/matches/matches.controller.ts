import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { MatchesService } from './matches.service';
import { MatchDto, MatchListResponseDto } from './dto/match.dto';

@Controller('matches')
@ApiTags('Matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  /**
   * GET /matches
   * All matches – filterable by status, league, date range, paginated
   */
  @Get()
  @ApiOperation({ summary: 'List matches', description: 'Paginated list of matches with optional filters' })
  @ApiQuery({ name: 'status', required: false, example: 'finished', description: 'scheduled | live | finished' })
  @ApiQuery({ name: 'leagueId', required: false })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-12-31' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiResponse({ status: 200, type: MatchListResponseDto })
  async getAllMatches(
    @Query('status') status?: string,
    @Query('leagueId') leagueId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ): Promise<MatchListResponseDto> {
    return this.matchesService.getAllMatches({ status, leagueId, limit, offset, from, to });
  }

  /**
   * GET /matches/upcoming
   * Next scheduled fixtures (earliest first)
   */
  @Get('upcoming')
  @ApiOperation({ summary: 'Upcoming fixtures', description: 'Next N scheduled matches, earliest first' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'leagueId', required: false })
  @ApiQuery({
    name: 'nextGameweek',
    required: false,
    example: 'true',
    description: 'If true, returns only fixtures from the next gameweek window',
  })
  @ApiResponse({ status: 200, type: MatchListResponseDto })
  async getUpcomingMatches(
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('leagueId') leagueId?: string,
    @Query('nextGameweek') nextGameweek?: string,
  ): Promise<MatchListResponseDto> {
    return this.matchesService.getUpcomingMatches(
      limit,
      leagueId,
      nextGameweek === 'true',
    );
  }

  /**
   * GET /matches/live
   * Currently live matches
   */
  @Get('live')
  @ApiOperation({ summary: 'Live matches', description: 'Matches currently in progress' })
  @ApiResponse({ status: 200, type: MatchListResponseDto })
  async getLiveMatches(): Promise<MatchListResponseDto> {
    return this.matchesService.getLiveMatches();
  }

  /**
   * GET /matches/team/:teamId
   * All matches for a team (home + away combined)
   */
  @Get('team/:teamId')
  @ApiParam({ name: 'teamId', description: 'Team UUID' })
  @ApiQuery({ name: 'status', required: false, example: 'finished' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiOperation({ summary: 'Team match history', description: 'All matches (home & away) for a team' })
  @ApiResponse({ status: 200, type: MatchListResponseDto })
  async getTeamMatches(
    @Param('teamId') teamId: string,
    @Query('status') status?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 10,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ): Promise<MatchListResponseDto> {
    return this.matchesService.getTeamMatches(teamId, limit, offset, status);
  }

  /**
   * GET /matches/team/:teamId/form
   * Last N results as W/D/L with aggregate stats
   */
  @Get('team/:teamId/form')
  @ApiParam({ name: 'teamId', description: 'Team UUID' })
  @ApiQuery({ name: 'last', required: false, example: 5, description: 'Number of recent matches to evaluate' })
  @ApiOperation({ summary: 'Team recent form', description: 'W/D/L form for last N finished matches' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        teamId: 'uuid',
        form: ['W', 'W', 'D', 'L', 'W'],
        wins: 3,
        draws: 1,
        losses: 1,
        played: 5,
        goalsFor: 8,
        goalsAgainst: 4,
      },
    },
  })
  async getTeamForm(
    @Param('teamId') teamId: string,
    @Query('last', new ParseIntPipe({ optional: true })) last = 5,
  ) {
    return this.matchesService.getTeamForm(teamId, last);
  }

  /**
   * GET /matches/team/:teamId/fixtures
   * Next N upcoming fixtures for a team
   */
  @Get('team/:teamId/fixtures')
  @ApiParam({ name: 'teamId', description: 'Team UUID' })
  @ApiQuery({ name: 'limit', required: false, example: 5 })
  @ApiOperation({ summary: 'Team upcoming fixtures', description: 'Next N scheduled matches for a team' })
  @ApiResponse({ status: 200, type: [MatchDto] })
  async getTeamFixtures(
    @Param('teamId') teamId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 5,
  ): Promise<MatchDto[]> {
    return this.matchesService.getTeamFixtures(teamId, limit);
  }

  /**
   * GET /matches/:id
   * Single match with full event timeline
   */
  @Get(':id')
  @ApiParam({ name: 'id', description: 'Match UUID' })
  @ApiOperation({ summary: 'Match detail', description: 'Full match info including all events (goals, cards, subs)' })
  @ApiResponse({ status: 200, type: MatchDto })
  @ApiResponse({ status: 404, description: 'Match not found' })
  async getMatchById(@Param('id') id: string): Promise<MatchDto> {
    return this.matchesService.getMatchById(id);
  }
}

