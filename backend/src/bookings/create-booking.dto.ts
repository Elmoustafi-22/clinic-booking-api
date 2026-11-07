import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateBookingDto {
  @IsString({ message: 'slot_id must be a string' })
  @Matches(/\S/, { message: 'slot_id must not be blank' })
  slot_id: string;

  @Transform(trimString, { toClassOnly: true })
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be blank' })
  name: string;

  @Transform(trimString, { toClassOnly: true })
  @IsString({ message: 'email must be a string' })
  @IsNotEmpty({ message: 'email must not be blank' })
  @IsEmail(
    { ignore_max_length: true },
    { message: 'email must be a valid email address' },
  )
  email: string;
}
