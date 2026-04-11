import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { LeaguesModule } from './leagues/leagues.module';
import { MatchesModule } from './matches/matches.module';
import { TeamsModule } from './teams/teams.module';
import { ScrapfootModule } from './scrapfoot/scrapfoot.module';
import { BetsModule } from './bets/bets.module';
import { PaymentsModule } from './payments/payments.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SchemaInitService } from './database/schema-init.service';

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
          throw new Error(
            'SCRAPFOOT_DATABASE_URL environment variable is not set',
          );
        }

        const typeOrmSync = configService.get<string>('TYPEORM_SYNC');
        const synchronize = typeOrmSync === 'true' || typeOrmSync === '1';

        const sslEnabledRaw = configService.get<string>(
          'SCRAPFOOT_DATABASE_SSL',
        );
        const sslEnabled =
          sslEnabledRaw === undefined ||
          sslEnabledRaw === '' ||
          sslEnabledRaw === 'true' ||
          sslEnabledRaw === '1';

        return {
          type: 'postgres' as const,
          url: databaseUrl,
          autoLoadEntities: true,
          // En prod: TYPEORM_SYNC=false + migrations / scripts SQL
          synchronize,
          ...(sslEnabled
            ? {
                ssl: {
                  rejectUnauthorized: false,
                },
              }
            : {}),
        };
      },
    }),

    ScheduleModule.forRoot(),
    PassportModule,
    AuthModule,
    WalletModule,
    ScrapfootModule,
    LeaguesModule,
    MatchesModule,
    TeamsModule,
    BetsModule,
    PaymentsModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService, SchemaInitService],
})
export class AppModule {}
