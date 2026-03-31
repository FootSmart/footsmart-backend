import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { LeaguesModule } from './leagues/leagues.module';
import { MatchesModule } from './matches/matches.module';
import { TeamsModule } from './teams/teams.module';
import { ScrapfootModule } from './scrapfoot/scrapfoot.module';
import { BetsModule } from './bets/bets.module';

@Module({
  imports: [
    // Load environment variables
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Database connection
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('SCRAPFOOT_DATABASE_URL');

        if (!databaseUrl) {
          throw new Error('SCRAPFOOT_DATABASE_URL environment variable is not set');
        }

        return {
          type: 'postgres' as const,
          url: databaseUrl,
          autoLoadEntities: true,
          synchronize: false, // Disabled - using manual table creation
        };
      },
    }),

    PassportModule,
    AuthModule,
    WalletModule,
    ScrapfootModule,
    LeaguesModule,
    MatchesModule,
    TeamsModule,
    BetsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

