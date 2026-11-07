import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { BookingsService } from './bookings/bookings.service';
import { ResetService } from './reset/reset.service';
import { SlotsService } from './slots/slots.service';
import type { Response } from 'express';
import { BookingHistoryService } from './bookings/booking-history.service';

@Controller()
export class AppController {
  constructor(
    private readonly resetService: ResetService,
    private readonly slotsService: SlotsService,
    private readonly bookingsService: BookingsService,
    private readonly historyService: BookingHistoryService,
  ) {}

  @Post('reset')
  @HttpCode(200)
  reset(@Body() body: unknown) {
    return this.resetService.reset(body);
  }

  @Get('slots')
  slots(@Query('provider') provider: unknown) {
    return this.slotsService.list(provider);
  }

  @Post('bookings')
  async book(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.bookingsService.book(body, key);
    response.status(result.status);
    return result.body;
  }

  @Get('bookings')
  history(
    @Query('email') email: unknown,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    return this.historyService.list(email, limit, cursor);
  }

  @Get('bookings/:id')
  booking(@Param('id') id: string) {
    return this.bookingsService.find(id);
  }

  @Delete('bookings/:id')
  cancel(@Param('id') id: string) {
    return this.bookingsService.cancel(id);
  }
}
