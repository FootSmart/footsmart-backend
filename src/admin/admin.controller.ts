import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AdminService } from './admin.service';
import {
  AdminBetsQueryDto,
  AdminMatchesQueryDto,
  AdminUsersQueryDto,
  CreateTestMatchDto,
  FinishMatchDto,
  FullTestScenarioDto,
  ResetUserPointsDto,
  UpdateMatchDto,
  UpdateMatchOddsDto,
  UpdateUserPointsDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboard();
  }

  @Get('users')
  getUsers(
    @Query(new ValidationPipe({ transform: true }))
    query: AdminUsersQueryDto,
  ) {
    return this.adminService.getUsers(query);
  }

  @Patch('users/:id/points')
  updateUserPoints(
    @Param('id') id: string,
    @Body() body: UpdateUserPointsDto,
  ) {
    return this.adminService.updateUserPoints(id, body);
  }

  @Patch('users/:id/status')
  updateUserStatus(
    @Param('id') id: string,
    @Body() body: UpdateUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(id, body);
  }

  @Patch('users/:id/role')
  updateUserRole(@Param('id') id: string, @Body() body: UpdateUserRoleDto) {
    return this.adminService.updateUserRole(id, body);
  }

  @Post('test-match')
  createTestMatch(@Body() body: CreateTestMatchDto) {
    return this.adminService.createTestMatch(body);
  }

  @Post('matches/:matchId/finish')
  finishMatch(
    @Param('matchId') matchId: string,
    @Body() body: FinishMatchDto,
  ) {
    return this.adminService.finishMatch(matchId, body);
  }

  @Post('users/:id/reset-points')
  resetUserPoints(
    @Param('id') id: string,
    @Body() body: ResetUserPointsDto,
  ) {
    return this.adminService.resetUserPoints(id, body);
  }

  @Post('settle')
  settle() {
    return this.adminService.settleAll();
  }

  @Get('matches')
  getMatches(
    @Query(new ValidationPipe({ transform: true }))
    query: AdminMatchesQueryDto,
  ) {
    return this.adminService.getMatches(query);
  }

  @Patch('matches/:id')
  updateMatch(@Param('id') id: string, @Body() body: UpdateMatchDto) {
    return this.adminService.updateMatch(id, body);
  }

  @Delete('matches/:id')
  deleteMatch(@Param('id') id: string) {
    return this.adminService.deleteMatch(id);
  }

  @Get('matches/:matchId/odds')
  getMatchOdds(@Param('matchId') matchId: string) {
    return this.adminService.getMatchOdds(matchId);
  }

  @Patch('matches/:matchId/odds')
  updateMatchOdds(
    @Param('matchId') matchId: string,
    @Body() body: UpdateMatchOddsDto,
  ) {
    return this.adminService.updateMatchOdds(matchId, body);
  }

  @Get('bets')
  getBets(
    @Query(new ValidationPipe({ transform: true }))
    query: AdminBetsQueryDto,
  ) {
    return this.adminService.getBets(query);
  }

  @Post('test-scenario/full')
  runFullTestScenario(@Body() body: FullTestScenarioDto) {
    return this.adminService.runFullTestScenario(body);
  }
}
