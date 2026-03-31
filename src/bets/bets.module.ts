import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BetsService } from './bets.service';
import { BetsController } from './bets.controller';
import { Bet } from './entities/bet.entity';
import { ScrapfootModule } from '../scrapfoot/scrapfoot.module';

@Module({
  imports: [TypeOrmModule.forFeature([Bet]), ScrapfootModule],
  controllers: [BetsController],
  providers: [BetsService],
  exports: [BetsService],
})
export class BetsModule {}
