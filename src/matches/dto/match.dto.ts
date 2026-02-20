import { ApiProperty } from '@nestjs/swagger';

export class TeamRefDto {
  @ApiProperty({ example: 'uuid', description: 'Team ID' })
  id: string;

  @ApiProperty({ example: 'Arsenal', description: 'Team name' })
  name: string;

  @ApiProperty({ example: 'ARS', description: 'Short name', nullable: true })
  shortName?: string;

  @ApiProperty({ example: 'https://cdn.example.com/arsenal.png', description: 'Logo URL', nullable: true })
  logo?: string;
}

export class MatchEventDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 45, nullable: true })
  minute?: number;

  @ApiProperty({ example: 2, nullable: true })
  extraMinute?: number;

  @ApiProperty({ example: 'Goal', description: 'Event type: Goal, Card, Substitution…' })
  type: string;

  @ApiProperty({ example: 'Normal Goal', nullable: true })
  detail?: string;

  @ApiProperty({ example: 'Bukayo Saka', nullable: true })
  player?: string;

  @ApiProperty({ example: 'uuid', nullable: true })
  playerId?: string;

  @ApiProperty({ example: 'Leandro Trossard', nullable: true })
  assistPlayer?: string;

  @ApiProperty({ example: 'uuid', nullable: true })
  assistPlayerId?: string;

  @ApiProperty({ example: 'uuid', nullable: true })
  teamId?: string;
}

export class MatchDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid', description: 'League ID' })
  leagueId: string;

  @ApiProperty({ example: 'Premier League' })
  leagueName?: string;

  @ApiProperty({ example: 'England', nullable: true })
  leagueCountry?: string;

  @ApiProperty({ type: () => TeamRefDto })
  homeTeam: TeamRefDto;

  @ApiProperty({ type: () => TeamRefDto })
  awayTeam: TeamRefDto;

  @ApiProperty({ example: '2026-02-21T15:00:00Z', nullable: true })
  matchDate?: string;

  @ApiProperty({ example: '15:00', nullable: true })
  matchTime?: string;

  @ApiProperty({ example: 28, nullable: true })
  matchday?: number;

  @ApiProperty({ example: 'Emirates Stadium', nullable: true })
  venue?: string;

  @ApiProperty({ example: 2, description: 'Full-time home goals' })
  homeGoals: number;

  @ApiProperty({ example: 1, description: 'Full-time away goals' })
  awayGoals: number;

  @ApiProperty({ example: 1, nullable: true, description: 'Half-time home goals' })
  htHomeGoals?: number;

  @ApiProperty({ example: 0, nullable: true, description: 'Half-time away goals' })
  htAwayGoals?: number;

  @ApiProperty({ example: 'H', nullable: true, description: 'H / D / A' })
  result?: string;

  @ApiProperty({ example: 'finished', description: 'scheduled / live / finished' })
  status: string;

  @ApiProperty({ example: 90, nullable: true })
  minute?: number;

  @ApiProperty({ example: 'Mike Dean', nullable: true })
  referee?: string;

  @ApiProperty({ example: 60000, nullable: true })
  attendance?: number;

  @ApiProperty({ example: 'ext_12345', nullable: true })
  externalId?: string;

  @ApiProperty({ type: () => [MatchEventDto], required: false })
  events?: MatchEventDto[];

  @ApiProperty({ example: '2026-02-20T10:00:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-02-20T10:00:00Z' })
  updatedAt: string;
}

export class MatchListResponseDto {
  @ApiProperty({ type: () => [MatchDto] })
  matches: MatchDto[];

  @ApiProperty({ example: 380 })
  total: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}
