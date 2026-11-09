import { Injectable } from '@nestjs/common';
import { and, asc, eq, notExists } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { bookings, slots } from '../database/schema';
import { stringInput } from '../common/input';

@Injectable()
export class SlotsService {
  constructor(private readonly database: DatabaseService) {}

  async list(provider: unknown) {
    const filter =
      provider === undefined ? undefined : stringInput(provider, 'provider');
    const result = await this.database.db
      .select({
        id: slots.id,
        provider: slots.provider,
        start: slots.start,
        end: slots.end,
        available: notExists(
          this.database.db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.slot_id, slots.id),
                eq(bookings.status, 'confirmed'),
              ),
            ),
        ),
      })
      .from(slots)
      .where(filter === undefined ? undefined : eq(slots.provider, filter))
      .orderBy(asc(slots.start), asc(slots.id));
    return { slots: result };
  }
}
