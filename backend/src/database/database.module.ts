import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { DatabaseClock } from './database-clock';

@Module({
  providers: [DatabaseService, DatabaseClock],
  exports: [DatabaseService, DatabaseClock],
})
export class DatabaseModule {}
