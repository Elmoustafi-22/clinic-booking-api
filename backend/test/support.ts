import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseClock } from '../src/database/database-clock';

config({ path: ['.env.test', '.env.level1-local', '.env'], quiet: true });
export const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) {
  throw new Error(
    'TEST_DATABASE_URL must explicitly name a dedicated database ending in _test',
  );
}
process.env.DATABASE_URL = testUrl;
// Isolated test credential, generated at runtime; never uses a developer's secret.
export const testApiKey = randomBytes(32).toString('hex');
process.env.API_KEY = testApiKey;

export async function makeApp(now?: SQL) {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (now) builder.overrideProvider(DatabaseClock).useValue({ now: () => now });
  const module = await builder.compile();
  const app = module.createNestApplication<INestApplication<App>>({
    bodyParser: false,
  });
  try {
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

export function authenticated(app: INestApplication<App>) {
  return {
    get: (path: string) =>
      request(app.getHttpServer()).get(path).set('X-API-Key', testApiKey),
    post: (path: string) =>
      request(app.getHttpServer()).post(path).set('X-API-Key', testApiKey),
    delete: (path: string) =>
      request(app.getHttpServer()).delete(path).set('X-API-Key', testApiKey),
  };
}
