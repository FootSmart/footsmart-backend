import { ApiProperty } from '@nestjs/swagger';

export class StandingDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Standing record ID (UUID)',
  })
  id: string;

  @ApiProperty({
    example: 1,
    description: 'Position in the league table',
  })
  position: number;

  @ApiProperty({
    example: 38,
    description: 'Number of matches played',
  })
  played: number;

  @ApiProperty({
    example: 28,
    description: 'Number of wins',
  })
  wins: number;

  @ApiProperty({
    example: 5,
    description: 'Number of draws',
  })
  draws: number;

  @ApiProperty({
    example: 5,
    description: 'Number of losses',
  })
  losses: number;

  @ApiProperty({
    example: 89,
    description: 'Total points in the league',
  })
  points: number;

  @ApiProperty({
    example: 53,
    description: 'Goal difference (goals for - goals against)',
  })
  goalDiff: number;

  @ApiProperty({
    example: 2025,
    description: 'Season year',
  })
  season: number;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440001',
    description: 'Team ID (UUID)',
  })
  teamId: string;

  @ApiProperty({
    example: 'Manchester United',
    description: 'Team name',
  })
  teamName: string;

  @ApiProperty({
    example: 'https://example.com/team-logo.png',
    description: 'Team logo URL',
    nullable: true,
  })
  teamLogo?: string;

  @ApiProperty({ example: 'England', nullable: true })
  teamCountry?: string;

  @ApiProperty({ example: 60, description: 'Goals scored', nullable: true })
  goalsFor?: number;

  @ApiProperty({ example: 25, description: 'Goals conceded', nullable: true })
  goalsAgainst?: number;

  @ApiProperty({ example: 'WWDLW', description: 'Recent form string from DB', nullable: true })
  form?: string;

  @ApiProperty({ example: 0, description: 'Current matchday', nullable: true })
  matchday?: number;
}

export class LeagueStandingsDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'League ID (UUID)',
  })
  id: string;

  @ApiProperty({
    example: 'Premier League',
    description: 'League name',
  })
  name: string;

  @ApiProperty({
    example: 'England',
    description: 'Country',
    nullable: true,
  })
  country?: string;

  @ApiProperty({
    example: 2025,
    description: 'Season year',
  })
  season?: number;

  @ApiProperty({
    type: StandingDto,
    isArray: true,
    description: 'List of standings ordered by position',
  })
  standings: StandingDto[];
}
