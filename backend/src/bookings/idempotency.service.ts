import {
  BadRequestException,
  HttpException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../database/database.service';
import { RESET_LOCK } from '../database/locks';
import { idempotencyRecords } from '../database/schema';

export interface BookingHttpResult {
  status: number;
  body: unknown;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (
      encoded === undefined ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new BadRequestException('body must contain JSON values');
    }
    return encoded;
  }
  if (Array.isArray(value))
    return '[' + value.map(canonicalJson).join(',') + ']';
  const object = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(object)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalJson(object[key]))
      .join(',') +
    '}'
  );
}

const scope = 'clinic-api';
const operation = 'POST /bookings';
// Two-int advisory keys are disjoint from the reset lock's one-bigint keyspace.
const lockNamespace = 410402;

@Injectable()
export class IdempotencyService {
  constructor(private readonly database: DatabaseService) {}

  async execute(
    key: string,
    body: unknown,
    perform: (tx: DatabaseTransaction) => Promise<BookingHttpResult>,
  ): Promise<BookingHttpResult> {
    const hash = createHash('sha256').update(canonicalJson(body)).digest('hex');
    // Fixed-size identity avoids B-tree entry-size limits for otherwise valid headers.
    const keyIdentity = createHash('sha256').update(key).digest('hex');
    const lock = createHash('sha256')
      .update(JSON.stringify([scope, operation, keyIdentity]))
      .digest()
      .readInt32BE(0);
    return this.database.db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock_shared(${RESET_LOCK})`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(${lockNamespace}::integer, ${lock}::integer)`,
        );
        const [stored] = await tx
          .select()
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.client_scope, scope),
              eq(idempotencyRecords.operation, operation),
              eq(idempotencyRecords.key, keyIdentity),
            ),
          );
        if (stored) {
          if (stored.request_hash !== hash)
            throw new UnprocessableEntityException(
              'idempotency key reused with a different body',
            );
          return { status: stored.response_status, body: stored.response_body };
        }
        let response: BookingHttpResult;
        try {
          // A nested transaction is a savepoint: recover from SQL failure before caching.
          response = await tx.transaction((savepoint) => perform(savepoint));
        } catch (error) {
          if (
            !(error instanceof HttpException) ||
            ![400, 404, 409].includes(error.getStatus())
          )
            throw error;
          response = {
            status: error.getStatus(),
            body: { error: error.message },
          };
        }
        const snapshot = JSON.parse(JSON.stringify(response.body)) as unknown;
        await tx.insert(idempotencyRecords).values({
          client_scope: scope,
          operation,
          key: keyIdentity,
          request_hash: hash,
          response_status: response.status,
          response_body: snapshot,
        });
        return { status: response.status, body: snapshot };
      },
      { isolationLevel: 'read committed' },
    );
  }
}
