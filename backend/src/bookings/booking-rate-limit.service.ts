import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DatabaseClock } from '../database/database-clock';
import { bookingAttempts } from '../database/schema';

export class BookingRateLimitException extends HttpException {
  constructor(readonly retryAfter: number) {
    super('too many booking attempts', 429);
  }
}

@Injectable()
export class BookingRateLimitService implements OnModuleDestroy {
  // Admission must commit while the caller retains its reset/key locks. Sharing
  // the caller's pool could exhaust it with parents waiting for child clients.
  private readonly pool: Pool;
  private readonly db: NodePgDatabase;

  constructor(private readonly clock: DatabaseClock) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    this.pool = new Pool({
      connectionString,
      max: 4,
      application_name: 'clinic-rate-limit',
      options:
        '-c timezone=UTC -c lock_timeout=15000 -c statement_timeout=20000',
      connectionTimeoutMillis: 30000,
    });
    this.pool.on('error', () =>
      new Logger(BookingRateLimitService.name).error(
        'admission connection failed',
      ),
    );
    this.db = drizzle(this.pool);
  }

  async admit(body: unknown): Promise<void> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const email = (body as Record<string, unknown>).email;
    if (typeof email !== 'string' || !email.trim()) return;
    // Fixed-size identity supports even invalid/oversized input without exposing
    // it to PostgreSQL text or B-tree limits. This is an identity, not encryption.
    const digest = createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest();
    const identity = digest.toString('hex');
    const retryAfter = await this.db.transaction(
      async (tx) => {
        // Caller already holds shared reset protection. Taking it again here can
        // deadlock behind a queued exclusive reset waiting for that caller.
        await tx.execute(
          sql`select pg_advisory_xact_lock(410403::integer, ${digest.readInt32BE(0)}::integer)`,
        );
        const clock = await tx.execute<{ now: string }>(sql`
        select to_char(${this.clock.now()} at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`);
        const now = clock.rows[0].now;
        const usage = await tx.execute<{
          count: number;
          retry: number | null;
        }>(sql`
        select count(*)::integer as count,
          greatest(1, ceil(extract(epoch from
            (min(attempted_at) + interval '60 seconds' - ${now}::timestamptz))))::integer as retry
        from booking_attempts where email = ${identity}
          and attempted_at > ${now}::timestamptz - interval '60 seconds'
          and attempted_at <= ${now}::timestamptz`);
        if (usage.rows[0].count >= 5) return usage.rows[0].retry ?? 1;
        await tx.insert(bookingAttempts).values({
          email: identity,
          attempted_at: sql`${now}::timestamptz`,
        });
        return undefined;
      },
      { isolationLevel: 'read committed' },
    );
    // Await COMMIT before permitting any validation or booking work.
    if (retryAfter !== undefined)
      throw new BookingRateLimitException(retryAfter);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
