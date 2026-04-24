import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  ForbiddenException,
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

  private requireAdmin(req: any) {
    const user = req.user as { id: string; email: string; role: string };
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    return user;
  }

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

  // ─── GET /analytics/admin/dashboard ─────────────────────────────────────

  @Get('admin/dashboard')
  @ApiOperation({
    summary: 'Get admin dashboard global statistics',
    description:
      'Returns global platform KPIs for admin dashboard: bettors count, activity, wallet volume and betting win-rate.',
  })
  @ApiOkResponse({ description: 'Admin dashboard statistics returned.' })
  async getAdminDashboard(@Req() req: any) {
    this.requireAdmin(req);
    return this.analyticsService.getAdminDashboardStats();
  }

  // ─── GET /analytics/admin/bettors ───────────────────────────────────────

  @Get('admin/bettors')
  @ApiOperation({
    summary: 'Get bettors list for admin dashboard',
    description:
      'Returns paginated bettors with account status, wallet balance, bets count and win-rate.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of bettors to return (default: 50)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Pagination offset (default: 0)',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by display name or email',
  })
  @ApiOkResponse({ description: 'Admin bettors list returned.' })
  async getAdminBettors(
    @Req() req: any,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
    @Query('search') search?: string,
  ) {
    this.requireAdmin(req);
    return this.analyticsService.getAdminBettors({ limit, offset, search });
  }
}
