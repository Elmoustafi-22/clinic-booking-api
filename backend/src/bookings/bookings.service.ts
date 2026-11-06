import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { objectInput, stringInput } from '../common/input';
import { DatabaseService } from '../database/database.service';
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

@Injectable()
export class BookingsService {
  constructor(private readonly database: DatabaseService) {}

  async create(body: unknown) {
    const input = objectInput(body);
    const slotId = stringInput(input.slot_id, 'slot_id');
    const name = stringInput(input.name, 'name').trim();
    const email = stringInput(input.email, 'email').trim().toLowerCase();
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock_shared(${RESET_LOCK})`);
      const [slot] = await tx
        .select({ id: slots.id })
        .from(slots)
        .where(eq(slots.id, slotId));
      if (!slot) throw new NotFoundException('slot not found');
      // Level 1 only. Started-slot checks and domain conflict handling are deferred.
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
    });
  }

  async find(id: string) {
    const [booking] = await this.database.db
      .select(bookingFields)
      .from(bookings)
      .where(eq(bookings.id, id));
    if (!booking) throw new NotFoundException('booking not found');
    return booking;
  }
}
