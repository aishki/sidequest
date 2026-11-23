import { db, schema } from '../../src/core/db.ts';

export type Settings = { weekHours: number; workDays: number[]; timezone: string };

const DEFAULTS: Settings = { weekHours: 40, workDays: [1, 2, 3, 4, 5], timezone: 'auto' };

export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(schema.settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const weekHours = Number(map.get('weekHours') ?? DEFAULTS.weekHours);
  const workDays = map.get('workDays');
  const timezone = map.get('timezone');
  return {
    weekHours: Number.isFinite(weekHours) && weekHours > 0 ? weekHours : DEFAULTS.weekHours,
    workDays: Array.isArray(workDays) ? workDays.map(Number).filter((d) => d >= 0 && d <= 6) : DEFAULTS.workDays,
    timezone: typeof timezone === 'string' ? timezone : DEFAULTS.timezone,
  };
}

/** Uses the timezone from settings (same rule as tt), so "today" matches the CLI. */
export async function applyTimezone() {
  const { timezone } = await getSettings();
  if (timezone !== 'auto') process.env.TZ = timezone;
}
