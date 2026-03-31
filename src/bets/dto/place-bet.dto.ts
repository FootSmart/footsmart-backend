import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { BetSelection } from '../entities/bet.entity';

export class PlaceBetDto {
  @ApiProperty({
    example: '0f7ffea0-45ef-4f1a-9df6-51f078f8c85f',
    description: 'Match UUID',
  })
  @IsString()
  @IsNotEmpty()
  matchId: string;

  @ApiProperty({
    enum: BetSelection,
    example: BetSelection.HOME,
    description: 'Selected market outcome: home, draw, or away',
  })
  @IsEnum(BetSelection)
  selection: BetSelection;

  @ApiProperty({
    example: 25,
    description: 'Bet stake amount in USD',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  stake: number;
}
