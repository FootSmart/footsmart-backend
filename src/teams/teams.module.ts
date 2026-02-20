import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { ScrapfootModule } from '../scrapfoot/scrapfoot.module';
import { MatchesModule } from '../matches/matches.module';

@Module({
  imports: [ScrapfootModule, MatchesModule],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
