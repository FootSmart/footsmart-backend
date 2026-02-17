import { IsNumber, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WithdrawDto {
  @ApiProperty({
    example: 50.25,
    description: 'Amount to withdraw',
  })
  @IsNumber()
  @IsPositive()
  amount: number;
}
