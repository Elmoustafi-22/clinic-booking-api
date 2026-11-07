import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { objectInput } from '../common/input';
import { CreateBookingDto } from './create-booking.dto';

@Injectable()
export class BookingValidationPipe implements PipeTransform<
  unknown,
  CreateBookingDto
> {
  transform(value: unknown): CreateBookingDto {
    const dto = plainToInstance(CreateBookingDto, objectInput(value), {
      enableImplicitConversion: false,
    });
    const errors = validateSync(dto, {
      validationError: { target: false, value: false },
    });
    if (errors.length) {
      const messages = errors.flatMap((error) =>
        Object.values(error.constraints ?? {}),
      );
      throw new BadRequestException(
        messages.join('; ') || 'invalid booking body',
      );
    }
    return dto;
  }
}
