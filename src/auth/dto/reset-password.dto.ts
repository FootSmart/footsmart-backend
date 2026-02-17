import { IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'reset_token_here',
    description: 'Password reset token received via email',
  })
  @IsString()
  token: string;

  @ApiProperty({
    example: 'NewPassword123!',
    description: 'New password (min 8 chars, must include uppercase, lowercase, number, special char)',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'Password must contain uppercase, lowercase, number and special character',
  })
  newPassword: string;
}
