import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, DrizzleQueryError, eq, sql } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { stringInput } from '../common/input';
import { CreateBookingDto } from './create-booking.dto';
import { DatabaseClock } from '../database/database-clock';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../database/database.service';
import {
  IdempotencyService,
  type BookingHttpResult,
} from './idempotency.service';
import { BookingRateLimitService } from './booking-rate-limit.service';
import { BookingValidationPipe } from './booking-validation.pipe';
import { RESET_LOCK } from '../database/locks';
import { bookings, slots } from '../database/schema';

const bookingFields = {
  id: bookings.id,
  slot_id: bookings.slot_id,
  name: bookings.name,
  email: bookings.email,
  status: bookings.status,
  created_at: bookings.created_at,
};

function isConfirmedSlotConflict(error: unknown): boolean {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return (
    cause instanceof DatabaseError &&
    cause.code === '23505' &&
    cause.table === 'bookings' &&
    cause.constraint === 'bookings_one_confirmed_per_slot_idx'
  );
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly clock: DatabaseClock,
    private readonly idempotency: IdempotencyService,
    private readonly validation: BookingValidationPipe,
    private readonly rateLimit: BookingRateLimitService,
  ) {}

  private async create(body: unknown) {
    return this.database.db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock_shared(${RESET_LOCK})`,
        );
        await this.rateLimit.admit(body);
        return this.insertBooking(tx, this.validation.transform(body));
      },
      { isolationLevel: 'read committed' },
    );
  }

  async book(
    body: unknown,
    key: string | undefined,
  ): Promise<BookingHttpResult> {
    if (key === undefined) {
      const booking = await this.create(body);
      return { status: 201, body: booking };
    }
    return this.idempotency.execute(key, body, async (tx) => {
      const booking = await this.insertBooking(
        tx,
        this.validation.transform(body),
      );
      return { status: 201, body: booking };
    });
  }

  private async insertBooking(
    tx: DatabaseTransaction,
    input: CreateBookingDto,
  ) {
    const slotId = stringInput(input.slot_id, 'slot_id');
    const name = stringInput(input.name, 'name').trim();
    const email = stringInput(input.email, 'email').trim().toLowerCase();
    const [slot] = await tx
      .select({ id: slots.id })
      .from(slots)
      .where(eq(slots.id, slotId))
      .for('update');
    if (!slot) throw new NotFoundException('slot not found');
    // A separate statement ensures time is evaluated AFTER any row-lock wait.
    const [eligibility] = await tx
      .select({
        started: sql<boolean>`${slots.start} <= ${this.clock.now()}`,
      })
      .from(slots)
      .where(eq(slots.id, slotId));
    if (eligibility.started)
      throw new BadRequestException('slot has already started');
    const [confirmed] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(eq(bookings.slot_id, slotId), eq(bookings.status, 'confirmed')),
      )
      .limit(1);
    if (confirmed) throw new ConflictException('slot already booked');
    try {
      const [booking] = await tx
        .insert(bookings)
        .values({
          id: randomUUID(),
          slot_id: slotId,
          name,
          email,
          status: 'confirmed',
        })
        .returning(bookingFields);
      return booking;
    } catch (error) {
      // Only this INSERT's named uniqueness violation is a booking conflict.
      // The caller rolls back its transaction/savepoint before further SQL.
      if (isConfirmedSlotConflict(error))
        throw new ConflictException('slot already booked');
      throw error;
    }
  }

  async cancel(id: string) {
    stringInput(id, 'id');
    return this.database.db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock_shared(${RESET_LOCK})`,
        );
        // Read immutable slot_id without taking a booking lock before the slot lock.
        const [existing] = await tx
          .select({ slot_id: bookings.slot_id })
          .from(bookings)
          .where(eq(bookings.id, id));
        if (!existing) throw new NotFoundException('booking not found');
        await tx
          .select({ id: slots.id })
          .from(slots)
          .where(eq(slots.id, existing.slot_id))
          .for('update');
        const [cancelled] = await tx
          .update(bookings)
          .set({ status: 'cancelled', cancelled_at: this.clock.now() })
          .where(and(eq(bookings.id, id), eq(bookings.status, 'confirmed')))
          .returning(bookingFields);
        if (!cancelled)
          throw new ConflictException('booking already cancelled');
        return cancelled;
      },
      { isolationLevel: 'read committed' },
    );
  }

  async find(id: string) {
    stringInput(id, 'id');
    const [booking] = await this.database.db
      .select(bookingFields)
      .from(bookings)
      .where(eq(bookings.id, id));
    if (!booking) throw new NotFoundException('booking not found');
    return booking;
  }
}
