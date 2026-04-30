import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AdminUsersQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  accountStatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class UpdateUserPointsDto {
  @Type(() => Number)
  @IsNumber()
  points: number;
}

export class UpdateUserStatusDto {
  @IsIn(['active', 'suspended', 'self_excluded'])
  account_status: 'active' | 'suspended' | 'self_excluded';
}

export class UpdateUserRoleDto {
  @IsIn(['player', 'coach', 'admin'])
  role: 'player' | 'coach' | 'admin';
}

export class CreateTestMatchDto {
  @IsUUID()
  leagueId: string;

  @IsUUID()
  homeTeamId: string;

  @IsUUID()
  awayTeamId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  minutesFromNow: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  betCloseMinutesBeforeKickoff: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1.01)
  homeOdds: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1.01)
  drawOdds: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1.01)
  awayOdds: number;
}

export class FinishMatchDto {
  @IsInt()
  @Min(0)
  homeGoals: number;

  @IsInt()
  @Min(0)
  awayGoals: number;
}

export class ResetUserPointsDto {
  @Type(() => Number)
  @IsNumber()
  points: number;
}

export class AdminMatchesQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  leagueId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class UpdateMatchDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  match_date?: string;

  @IsOptional()
  @IsString()
  match_time?: string;

  @IsOptional()
  @IsString()
  bet_closes_at?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  home_goals?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  away_goals?: number | null;

  @IsOptional()
  @IsString()
  result?: string | null;
}

export class UpdateMatchOddsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1.01)
  homeOdds: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1.01)
  drawOdds: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1.01)
  awayOdds: number;
}

export class AdminBetsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  matchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class FullTestScenarioDto {
  @IsEmail()
  userEmail: string;

  @IsNumber()
  points: number;

  @IsUUID()
  leagueId: string;

  @IsUUID()
  homeTeamId: string;

  @IsUUID()
  awayTeamId: string;
}
