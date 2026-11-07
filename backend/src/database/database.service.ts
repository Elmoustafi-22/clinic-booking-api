import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    this.pool = new Pool({
      connectionString,
      options: '-c timezone=UTC',
      connectionTimeoutMillis: 5000,
    });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleInit() {
    await this.pool.query('select 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

export type DatabaseTransaction = Parameters<
  Parameters<DatabaseService['db']['transaction']>[0]
>[0];
