import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'Nigeria' })
  @IsString()
  @MaxLength(60)
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: '2000-01-01' })
  @IsString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'FC Academy' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  club?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  subscriptionActive?: boolean;

  @ApiPropertyOptional({ example: 'pro_monthly' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  subscriptionPlan?: string;

  @ApiPropertyOptional({ example: '2026-01-10T12:00:00Z' })
  @IsDateString()
  @IsOptional()
  subscriptionEndsAt?: string;
}
