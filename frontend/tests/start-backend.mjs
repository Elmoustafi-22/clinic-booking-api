import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve("../backend/package.json"));
require("dotenv").config({
  path: [
    "../backend/.env.test",
    "../backend/.env.level1-local",
    "../backend/.env",
  ],
  quiet: true,
});
const database = process.env.TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith("_test"))
  throw new Error("Use a dedicated TEST_DATABASE_URL ending in _test");
if (!process.env.API_KEY) throw new Error("Isolated test key is required");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: database });
try {
  await require("drizzle-orm/node-postgres/migrator").migrate(
    require("drizzle-orm/node-postgres").drizzle(pool),
    { migrationsFolder: resolve("../backend/drizzle") },
  );
} finally {
  await pool.end();
}
process.env.DATABASE_URL = database;
process.env.PORT = "3101";
require("./dist/main.js");
