import { ApiProperty } from '@nestjs/swagger';
import { PlayerDto } from './player.dto';

export class TeamDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid', nullable: true, description: 'League ID' })
  leagueId?: string;

  @ApiProperty({ example: 'Premier League', nullable: true })
  leagueName?: string;

  @ApiProperty({ example: 'Arsenal' })
  name: string;

  @ApiProperty({ example: 'ARS', nullable: true })
  shortName?: string;

  @ApiProperty({ example: 'https://cdn.example.com/arsenal.png', nullable: true })
  logo?: string;

  @ApiProperty({ example: 'England', nullable: true })
  country?: string;

  @ApiProperty({ example: 'Emirates Stadium', nullable: true })
  stadium?: string;

  @ApiProperty({ example: 60704, nullable: true })
  stadiumCapacity?: number;

  @ApiProperty({ example: 1886, nullable: true })
  foundedYear?: number;

  @ApiProperty({ example: '2026-02-20T10:00:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-02-20T10:00:00Z' })
  updatedAt: string;
}

export class TeamWithPlayersDto extends TeamDto {
  @ApiProperty({ type: () => [PlayerDto] })
  players: PlayerDto[];
}

export class TeamStatsDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid' })
  teamId: string;

  @ApiProperty({ example: 2025 })
  season: number;

  @ApiProperty({ example: 28 })
  played: number;

  @ApiProperty({ example: 18 })
  wins: number;

  @ApiProperty({ example: 5 })
  draws: number;

  @ApiProperty({ example: 5 })
  losses: number;

  @ApiProperty({ example: 72 })
  goalsFor: number;

  @ApiProperty({ example: 35 })
  goalsAgainst: number;

  @ApiProperty({ example: 59 })
  points: number;

  @ApiProperty({ example: 10, description: 'Clean sheets' })
  cleanSheets: number;

  @ApiProperty({ example: 3, description: 'Matches without scoring' })
  failedToScore: number;

  @ApiProperty({ example: 'WWDWW', nullable: true })
  currentStreak?: string;

  @ApiProperty({ example: 7, nullable: true })
  longestWinStreak?: number;

  @ApiProperty({ example: 9, nullable: true })
  longestUnbeaten?: number;

  @ApiProperty({ example: 4, nullable: true })
  longestLosing?: number;

  @ApiProperty({ example: 42, nullable: true })
  totalYellows?: number;

  @ApiProperty({ example: 2, nullable: true })
  totalReds?: number;

  @ApiProperty({ example: '2026-02-20T10:00:00Z' })
  updatedAt: string;
}
