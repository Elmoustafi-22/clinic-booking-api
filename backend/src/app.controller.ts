import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { BookingsService } from './bookings/bookings.service';
import { ResetService } from './reset/reset.service';
import { SlotsService } from './slots/slots.service';
import { CreateBookingDto } from './bookings/create-booking.dto';
import { BookingValidationPipe } from './bookings/booking-validation.pipe';

@Controller()
export class AppController {
  constructor(
    private readonly resetService: ResetService,
    private readonly slotsService: SlotsService,
    private readonly bookingsService: BookingsService,
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
  book(@Body(BookingValidationPipe) body: CreateBookingDto) {
    return this.bookingsService.create(body);
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
