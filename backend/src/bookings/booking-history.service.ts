import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { bookings } from '../database/schema';
import { BookingCursor } from './booking-cursor';

@Injectable()
export class BookingHistoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cursor: BookingCursor,
  ) {}

  async list(emailValue: unknown, limitValue: unknown, cursorValue: unknown) {
    if (
      typeof emailValue !== 'string' ||
      !emailValue.trim() ||
      emailValue.includes('\0')
    )
      throw new BadRequestException('email is required');
    const email = emailValue.trim().toLowerCase();
    if (
      limitValue !== undefined &&
      (typeof limitValue !== 'string' || !/^\d+$/.test(limitValue))
    )
      throw new BadRequestException('limit must be an integer from 1 to 50');
    const limit = limitValue === undefined ? 10 : Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new BadRequestException('limit must be an integer from 1 to 50');
    const position =
      cursorValue === undefined
        ? undefined
        : this.cursor.decode(cursorValue, email);
    const rows = await this.database.db
      .select({
        id: bookings.id,
        slot_id: bookings.slot_id,
        name: bookings.name,
        email: bookings.email,
        status: bookings.status,
        created_at: bookings.created_at,
        position_time: sql<string>`to_char(${bookings.created_at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.email, email),
          position
            ? sql`(${bookings.created_at}, ${bookings.id}) > (${position.time}::timestamptz, ${position.id}::text)`
            : undefined,
        ),
      )
      .orderBy(asc(bookings.created_at), asc(bookings.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      bookings: page.map((booking) => ({
        id: booking.id,
        slot_id: booking.slot_id,
        name: booking.name,
        email: booking.email,
        status: booking.status,
        created_at: booking.created_at,
      })),
      next_cursor:
        rows.length > limit && last
          ? this.cursor.encode(email, last.position_time, last.id)
          : null,
    };
  }
}
