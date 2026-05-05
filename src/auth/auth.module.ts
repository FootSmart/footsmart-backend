import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtGuard } from './jwt.guard';
import { UsersModule } from './users/users.module';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailService } from './services/email.service';
import { PasswordResetRateLimitGuard } from './guards/password-reset-rate-limit.guard';
import { ActiveKycGuard } from './guards/active-kyc.guard';
import { getJwtExpiresIn, getJwtSecret } from './jwt-config.helper';

@Module({
  imports: [
    TypeOrmModule.forFeature([PasswordResetToken]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: getJwtSecret(configService),
        signOptions: { expiresIn: getJwtExpiresIn(configService) },
      }),
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService, 
    JwtStrategy, 
    JwtGuard, 
    EmailService,
    PasswordResetRateLimitGuard,
    ActiveKycGuard,
  ],
  exports: [AuthService, JwtGuard, JwtModule, ActiveKycGuard],
})
export class AuthModule {}
