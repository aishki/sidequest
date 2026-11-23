import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
try { process.loadEnvFile(envFile); } catch { /* fall back to the environment */ }

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run scripts/create-db.sh first, or add it to .env.');
  process.exit(1);
}

export const sql = postgres(url, { max: 4, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export { schema };
