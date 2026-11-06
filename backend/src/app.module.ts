import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { APP_FILTER } from '@nestjs/core';
import { BookingsService } from './bookings/bookings.service';
import { ApiErrorFilter } from './common/api-error.filter';
import { DatabaseModule } from './database/database.module';
import { ResetService } from './reset/reset.service';
import { SlotsService } from './slots/slots.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AppController],
  providers: [
    ResetService,
    SlotsService,
    BookingsService,
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule {}
