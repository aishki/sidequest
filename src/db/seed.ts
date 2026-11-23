// Loads projects and settings from seed/projects.json (falls back to the example).
// Safe to re-run: projects are matched by prefix and updated in place; nothing is deleted.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql as dsql } from 'drizzle-orm';
import { db, sql, schema } from './client.ts';

type SeedProject = {
  name: string; prefix: string; aliases?: string[]; color: string;
  weeklyPct?: number; isOverhead?: boolean;
};
type SeedFile = { settings?: Record<string, unknown>; projects: SeedProject[] };

const local = fileURLToPath(new URL('../../seed/projects.json', import.meta.url));
const example = fileURLToPath(new URL('../../seed/projects.example.json', import.meta.url));
const file = process.argv[2] ?? (existsSync(local) ? local : example);
const seed: SeedFile = JSON.parse(readFileSync(file, 'utf8'));

// Every alias must point at exactly one project.
const seen = new Map<string, string>();
for (const p of seed.projects) {
  for (const a of [p.prefix.toLowerCase(), ...(p.aliases ?? [])].map((s) => s.trim().toLowerCase())) {
    const other = seen.get(a);
    if (other && other !== p.prefix) throw new Error(`Alias "${a}" is used by both ${other} and ${p.prefix}.`);
    seen.set(a, p.prefix);
  }
}

try {
  await db.transaction(async (tx) => {
    for (const [i, p] of seed.projects.entries()) {
      const row = {
        name: p.name.trim(),
        prefix: p.prefix.trim().toUpperCase(),
        aliases: [...new Set((p.aliases ?? []).map((a) => a.trim().toLowerCase()))],
        color: p.color.toLowerCase(),
        weeklyPct: p.weeklyPct ?? 0,
        isOverhead: p.isOverhead ?? false,
        sortOrder: i + 1,
      };
      await tx.insert(schema.projects).values(row).onConflictDoUpdate({
        target: schema.projects.prefix,
        set: { name: row.name, aliases: row.aliases, color: row.color, weeklyPct: row.weeklyPct,
          isOverhead: row.isOverhead, sortOrder: row.sortOrder },
      });
    }
    for (const [key, value] of Object.entries(seed.settings ?? {})) {
      await tx.insert(schema.settings).values({ key, value }).onConflictDoUpdate({
        target: schema.settings.key, set: { value, updatedAt: dsql`now()` },
      });
    }
    await tx.insert(schema.events).values({
      kind: 'seed', source: 'system', data: { projects: seed.projects.length },
    });
  });
  console.log(`Seeded ${seed.projects.length} projects from ${file.replace(/.*[\\/]seed[\\/]/, 'seed/')}.`);
} finally {
  await sql.end();
}
