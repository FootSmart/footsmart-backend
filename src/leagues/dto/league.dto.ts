import { ApiProperty } from '@nestjs/swagger';

export class LeagueDto {
  @ApiProperty({ example: 'uuid', description: 'League ID (UUID)' })
  id: string;

  @ApiProperty({ example: 'Premier League' })
  name: string;

  @ApiProperty({ example: 'England', nullable: true })
  country?: string;

  @ApiProperty({ example: 2025, nullable: true })
  season?: number;

  @ApiProperty({ example: 1, description: 'League tier (1 = top flight)', nullable: true })
  tier?: number;

  @ApiProperty({ example: 'UEFA', nullable: true })
  confederation?: string;

  @ApiProperty({ example: '2026-02-20T10:00:00Z' })
  createdAt?: string;

  @ApiProperty({ example: '2026-02-20T10:00:00Z' })
  updatedAt?: string;
}
