import { ApiProperty } from '@nestjs/swagger';

export class MatchOddsDto {
  @ApiProperty({ example: '0f7ffea0-45ef-4f1a-9df6-51f078f8c85f' })
  matchId: string;

  @ApiProperty({ example: 'Arsenal' })
  homeTeam: string;

  @ApiProperty({ example: 'Chelsea' })
  awayTeam: string;

  @ApiProperty({ example: 48.5 })
  homeProb: number;

  @ApiProperty({ example: 26.8 })
  drawProb: number;

  @ApiProperty({ example: 24.7 })
  awayProb: number;

  @ApiProperty({ example: 2.05 })
  homeOdds: number;

  @ApiProperty({ example: 3.3 })
  drawOdds: number;

  @ApiProperty({ example: 3.8 })
  awayOdds: number;

  @ApiProperty({ example: '2026-02-21T14:55:00Z', nullable: true })
  betClosesAt?: string | null;

  @ApiProperty({ example: true })
  isBettingOpen: boolean;

  @ApiProperty({ example: 1140, description: 'Seconds left until betting closes' })
  secondsUntilClose: number;
}
