import {
  Controller,
  Get,
  Param,
  Query,
  ParseBoolPipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { TeamDto, TeamWithPlayersDto, TeamStatsDto } from './dto/team.dto';
import { PlayerDto } from './dto/player.dto';

@Controller('teams')
@ApiTags('Teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  /**
   * GET /teams
   * All teams, optionally filtered by league
   */
  @Get()
  @ApiOperation({ summary: 'List all teams', description: 'All teams, optionally filtered by leagueId' })
  @ApiQuery({ name: 'leagueId', required: false, description: 'Filter by league UUID' })
  @ApiResponse({ status: 200, type: [TeamDto] })
  async getAllTeams(@Query('leagueId') leagueId?: string): Promise<TeamDto[]> {
    return this.teamsService.getAllTeams(leagueId);
  }

  /**
   * GET /teams/league/:leagueId/top-scorers
   * Top scorers across all teams in a league
   */
  @Get('league/:leagueId/top-scorers')
  @ApiParam({ name: 'leagueId', description: 'League UUID' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiOperation({ summary: 'League top scorers', description: 'Top goal-scorers in a league, ordered by goals' })
  @ApiResponse({ status: 200, type: [PlayerDto] })
  async getLeagueTopScorers(
    @Param('leagueId') leagueId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 10,
  ): Promise<PlayerDto[]> {
    return this.teamsService.getLeagueTopScorers(leagueId, limit);
  }

  /**
   * GET /teams/:id
   * Single team details (name, logo, stadium, country, …)
   */
  @Get(':id')
  @ApiParam({ name: 'id', description: 'Team UUID' })
  @ApiOperation({ summary: 'Get team by ID', description: 'Team details including logo, stadium, founded year' })
  @ApiResponse({ status: 200, type: TeamDto })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async getTeamById(@Param('id') id: string): Promise<TeamDto> {
    return this.teamsService.getTeamById(id);
  }

  /**
   * GET /teams/:id/full
   * Team + complete squad with player stats in one response
   */
  @Get(':id/full')
  @ApiParam({ name: 'id', description: 'Team UUID' })
  @ApiOperation({ summary: 'Team + squad', description: 'Team details AND full player list in one call' })
  @ApiResponse({ status: 200, type: TeamWithPlayersDto })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async getTeamWithPlayers(@Param('id') id: string): Promise<TeamWithPlayersDto> {
    return this.teamsService.getTeamWithPlayers(id);
  }

  /**
   * GET /teams/:id/players
   * Full squad with individual player stats
   */
  @Get(':id/players')
  @ApiParam({ name: 'id', description: 'Team UUID' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean, example: false })
  @ApiOperation({ summary: 'Team players', description: 'All squad members with goals, assists, cards, minutes' })
  @ApiResponse({ status: 200, type: [PlayerDto] })
  async getTeamPlayers(
    @Param('id') id: string,
    @Query('activeOnly', new ParseBoolPipe({ optional: true })) activeOnly = false,
  ): Promise<PlayerDto[]> {
    return this.teamsService.getTeamPlayers(id, activeOnly);
  }

  /**
   * GET /teams/:id/stats
   * Season-aggregated team stats (form streak, clean sheets, etc.)
   */
  @Get(':id/stats')
  @ApiParam({ name: 'id', description: 'Team UUID' })
  @ApiQuery({ name: 'season', required: false, example: 2025 })
  @ApiOperation({ summary: 'Team season stats', description: 'Aggregate stats: wins, draws, losses, streaks, clean sheets…' })
  @ApiResponse({ status: 200, type: TeamStatsDto })
  @ApiResponse({ status: 404, description: 'No stats found' })
  async getTeamStats(
    @Param('id') id: string,
    @Query('season', new ParseIntPipe({ optional: true })) season?: number,
  ): Promise<TeamStatsDto> {
    return this.teamsService.getTeamStats(id, season);
  }
}
