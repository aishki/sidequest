import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client.ts';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

try {
  await migrate(db, { migrationsFolder });
  console.log('Database is up to date.');
} finally {
  await sql.end();
}
