import { db, sql, schema } from '../db/client.ts';

export { db, sql, schema };
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run a query: the pool or an open transaction. */
export type Exec = Db | Tx;
/** Who made a change. Every write records one in the events table. */
export type Source = 'cli' | 'dashboard' | 'system';

export async function logEvent(x: Exec, e: {
  kind: string; source: Source; ticketId?: number | null; projectId?: number | null; data?: Record<string, unknown>;
}) {
  await x.insert(schema.events).values({
    kind: e.kind, source: e.source, ticketId: e.ticketId ?? null, projectId: e.projectId ?? null, data: e.data ?? {},
  });
}
