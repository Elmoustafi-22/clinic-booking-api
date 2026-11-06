import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, notExists } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { bookings, slots } from '../database/schema';

@Injectable()
export class SlotsService {
  constructor(private readonly database: DatabaseService) {}

  async list(provider: unknown) {
    if (provider !== undefined && typeof provider !== 'string') {
      throw new BadRequestException('provider must be a string');
    }
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
      .where(provider === undefined ? undefined : eq(slots.provider, provider))
      .orderBy(asc(slots.start), asc(slots.id));
    return { slots: result };
  }
}
