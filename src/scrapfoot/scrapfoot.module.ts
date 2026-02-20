import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { scrapfootDbProvider } from './config/scrapfoot-db.provider';

@Module({
  imports: [ConfigModule],
  providers: [scrapfootDbProvider],
  exports: [scrapfootDbProvider],
})
export class ScrapfootModule {}
