import { BadRequestException, Injectable } from '@nestjs/common';
import { isISO8601 } from 'class-validator';
import { sql } from 'drizzle-orm';
import { objectInput, stringInput } from '../common/input';
import { DatabaseService } from '../database/database.service';
import { RESET_LOCK } from '../database/locks';
import {
  bookingAttempts,
  bookings,
  idempotencyRecords,
  slots,
} from '../database/schema';

function instant(value: unknown, field: string): Date {
  const text = stringInput(value, field);
  if (
    !isISO8601(text, { strict: true, strictSeparator: true }) ||
    !/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)
  ) {
    throw new BadRequestException(
      `${field} must be a date-time with a timezone`,
    );
  }
  const result = new Date(text);
  if (!Number.isFinite(result.getTime())) {
    throw new BadRequestException(`${field} must be a valid date-time`);
  }
  return result;
}

@Injectable()
export class ResetService {
  constructor(private readonly database: DatabaseService) {}

  async reset(body: unknown) {
    const input = objectInput(body);
    if (!Array.isArray(input.slots))
      throw new BadRequestException('slots must be an array');
    const ids = new Set<string>();
    // Validate the entire payload before opening the destructive transaction.
    const inventory = input.slots.map((value: unknown) => {
      const slot = objectInput(value);
      const id = stringInput(slot.id, 'id');
      if (ids.has(id)) throw new BadRequestException('duplicate slot id');
      ids.add(id);
      return {
        id,
        provider: stringInput(slot.provider, 'provider'),
        start: instant(slot.start, 'start'),
        end: instant(slot.end, 'end'),
      };
    });
    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${RESET_LOCK})`);
      await tx.delete(idempotencyRecords);
      await tx.delete(bookingAttempts);
      await tx.delete(bookings);
      await tx.delete(slots);
      // Batching stays below PostgreSQL's parameter limit, without capping the API array.
      for (let offset = 0; offset < inventory.length; offset += 1000) {
        await tx.insert(slots).values(inventory.slice(offset, offset + 1000));
      }
    });
    return {};
  }
}
