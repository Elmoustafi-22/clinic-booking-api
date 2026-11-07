import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

@Injectable()
export class DatabaseClock {
  // SQL rather than a JS Date preserves database precision and reads time after lock waits.
  now() {
    return sql`clock_timestamp()`;
  }
}
