import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtGuard } from '../auth/jwt.guard';

@ApiTags('Analytics')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // ─── GET /analytics/user/stats ────────────────────────────────────────────

  @Get('user/stats')
  @ApiOperation({
    summary: 'Get authenticated user betting statistics',
    description:
      'Returns comprehensive betting analytics for the authenticated user: win rate, profit, ROI, streaks, monthly breakdown, etc.',
  })
  @ApiOkResponse({
    description: 'User betting statistics returned successfully.',
  })
  getUserStats(@Req() req: any) {
    const user = req.user as { id: string; email: string; role: string };
    return this.analyticsService.getUserStats(user.id);
  }

  // ─── GET /analytics/matches/insights ─────────────────────────────────────

  @Get('matches/insights')
  @ApiOperation({
    summary: 'Get advanced match insights from finished matches',
    description:
      'Returns finished match data with aggregated insights: avg goals, home/draw/away win rates, over 2.5 rate, BTTS rate.',
  })
  @ApiQuery({
    name: 'leagueId',
    required: false,
    type: String,
    description: 'Filter by league UUID',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of matches to analyse (default: 30)',
  })
  @ApiOkResponse({ description: 'Match insights returned successfully.' })
  getMatchInsights(
    @Query('leagueId') leagueId?: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit?: number,
  ) {
    return this.analyticsService.getMatchInsights({ leagueId, limit });
  }

  // ─── GET /analytics/market/movements ─────────────────────────────────────

  @Get('market/movements')
  @ApiOperation({
    summary: 'Get market movements for upcoming scheduled matches',
    description:
      'Returns odds and probability data for scheduled matches. Includes a `valueLabel` field highlighting value-bet opportunities.',
  })
  @ApiQuery({
    name: 'leagueId',
    required: false,
    type: String,
    description: 'Filter by league UUID',
  })
  @ApiOkResponse({ description: 'Market movements returned successfully.' })
  getMarketMovements(@Query('leagueId') leagueId?: string) {
    return this.analyticsService.getMarketMovements(leagueId);
  }

  // ─── GET /analytics/predictions ──────────────────────────────────────────

  @Get('predictions')
  @ApiOperation({
    summary: 'Get AI predictions for upcoming scheduled matches',
    description:
      'Returns a predicted outcome (home/draw/away) for each upcoming match based on implied probabilities, with confidence level (high/medium/low).',
  })
  @ApiQuery({
    name: 'leagueId',
    required: false,
    type: String,
    description: 'Filter by league UUID',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of predictions to return (default: 20)',
  })
  @ApiOkResponse({ description: 'Predictions returned successfully.' })
  getPredictions(
    @Query('leagueId') leagueId?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.analyticsService.getPredictions(leagueId, limit);
  }

  // ─── GET /analytics/match-predictions ───────────────────────────────────

  @Get('match-predictions')
  @ApiOperation({
    summary: 'Get match predictions from Supabase table',
    description:
      'Returns paginated predictions from match_predictions with optional team search.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by home or away team name',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: 'Items per page (default: 10)',
  })
  @ApiOkResponse({ description: 'Match predictions returned successfully.' })
  getMatchPredictions(
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize?: number,
  ) {
    return this.analyticsService.getMatchPredictions({
      search,
      page,
      pageSize,
    });
  }
}
