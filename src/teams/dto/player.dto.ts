import { ApiProperty } from '@nestjs/swagger';

export class PlayerDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid', nullable: true })
  teamId?: string;

  @ApiProperty({ example: 'Bukayo Saka' })
  name: string;

  @ApiProperty({ example: 'B. Saka', nullable: true })
  shortName?: string;

  @ApiProperty({ example: 'England', nullable: true })
  nationality?: string;

  @ApiProperty({ example: 'Forward', nullable: true })
  position?: string;

  @ApiProperty({ example: '2001-09-05', nullable: true })
  dateOfBirth?: string;

  @ApiProperty({ example: 22, nullable: true })
  age?: number;

  @ApiProperty({ example: 178, nullable: true })
  heightCm?: number;

  @ApiProperty({ example: 71, nullable: true })
  weightKg?: number;

  @ApiProperty({ example: 7, nullable: true })
  shirtNumber?: number;

  @ApiProperty({ example: 'https://cdn.example.com/player.png', nullable: true })
  photoUrl?: string;

  @ApiProperty({ example: 30, description: 'Appearances this season' })
  appearances: number;

  @ApiProperty({ example: 2700, description: 'Minutes played' })
  minutesPlayed: number;

  @ApiProperty({ example: 14 })
  goals: number;

  @ApiProperty({ example: 11 })
  assists: number;

  @ApiProperty({ example: 2 })
  yellowCards: number;

  @ApiProperty({ example: 0 })
  redCards: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-02-20T10:00:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-02-20T10:00:00Z' })
  updatedAt: string;
}

export class PlayerStatsDto {
  @ApiProperty({ example: 'uuid' })
  playerId: string;

  @ApiProperty({ example: 'Bukayo Saka' })
  playerName: string;

  @ApiProperty({ example: 'Forward', nullable: true })
  position?: string;

  @ApiProperty({ example: 'England', nullable: true })
  nationality?: string;

  @ApiProperty({ example: 22, nullable: true })
  age?: number;

  @ApiProperty({ example: 7, nullable: true })
  shirtNumber?: number;

  @ApiProperty({ example: 'Arsenal', nullable: true })
  teamName?: string;

  @ApiProperty({ example: 'Premier League', nullable: true })
  league?: string;

  @ApiProperty({ example: 2025, nullable: true })
  season?: number;

  @ApiProperty({ example: 30 })
  appearances: number;

  @ApiProperty({ example: 2700 })
  minutesPlayed: number;

  @ApiProperty({ example: 14 })
  goals: number;

  @ApiProperty({ example: 11 })
  assists: number;

  @ApiProperty({ example: 25, description: 'Goals + Assists' })
  goalContributions: number;

  @ApiProperty({ example: 2 })
  yellowCards: number;

  @ApiProperty({ example: 0 })
  redCards: number;

  @ApiProperty({ example: 0.47, description: 'Goals divided by appearances' })
  goalsPerGame: number;

  @ApiProperty({ example: 0.52, description: 'Goals per 90 minutes' })
  goalsPer90: number;
}
