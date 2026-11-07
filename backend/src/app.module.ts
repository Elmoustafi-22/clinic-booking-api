import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { ApiKeyGuard } from './auth/api-key.guard';
import { ApiKeyMiddleware } from './auth/api-key.middleware';
import { BookingsService } from './bookings/bookings.service';
import { BookingRateLimitService } from './bookings/booking-rate-limit.service';
import { IdempotencyService } from './bookings/idempotency.service';
import { BookingValidationPipe } from './bookings/booking-validation.pipe';
import { BookingHistoryService } from './bookings/booking-history.service';
import { BookingCursor } from './bookings/booking-cursor';
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
    IdempotencyService,
    BookingRateLimitService,
    BookingValidationPipe,
    BookingHistoryService,
    BookingCursor,
    ApiKeyGuard,
    { provide: APP_GUARD, useExisting: ApiKeyGuard },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Disable Nest's default parsers in the application factory so auth is first.
    consumer
      .apply(ApiKeyMiddleware, json(), urlencoded({ extended: true }))
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
