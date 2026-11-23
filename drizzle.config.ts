import { defineConfig } from 'drizzle-kit';

try { process.loadEnvFile(); } catch { /* .env is optional when DATABASE_URL is already set */ }

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
});
