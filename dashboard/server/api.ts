import type { IncomingMessage, ServerResponse } from 'node:http';
import { and, count, desc, eq, gte, lt } from 'drizzle-orm';
import { db, schema, sql, type Source } from '../../src/core/db.ts';
import { listProjects, type Project } from '../../src/core/projects.ts';
import {
  addSubtasks, changeSubtask, createTicket, deleteTicket, getTicket, listSubtasks, listTickets, moveTicket,
  updateTicket, type Ticket, type TicketFields,
} from '../../src/core/tickets.ts';
import {
  cancelTimer, getWeekPlan, logTime, resolveTarget, runningTimer, setWeekend, startTimer, stopTimer, ticketTime,
} from '../../src/core/time.ts';
import {
  addDays, cleanTitle, isoDate, mondayOf, parseClock, parseDuration, parseKey, parsePriority, parseStatus, parseType,
  startOfDay, today, UserError, weekday, type TicketStatus,
} from '../../src/core/parse.ts';
import { dayTargets, entriesBetween, rangeTargets, sumBy } from './planning.ts';
import { getSettings } from './settings.ts';

const SRC: Source = 'dashboard';
const OPEN: TicketStatus[] = ['inbox', 'todo', 'in_progress', 'blocked'];
const MAX = 5000;

// ---------- tiny router ----------

type Ctx = { url: URL; params: string[]; body: Record<string, unknown> };
type Handler = (c: Ctx) => Promise<unknown>;
const routes: { method: string; re: RegExp; h: Handler }[] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push({ method, re: new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`), h });

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === '/api/live') return live(req, res);
  const method = req.method ?? 'GET';
  for (const r of routes) {
    const m = r.method === method && url.pathname.match(r.re);
    if (!m) continue;
    try {
      const body = method === 'GET' ? {} : await readJson(req);
      const data = await r.h({ url, params: m.slice(1).map(decodeURIComponent), body });
      if (method !== 'GET') void poll(); // tell every open tab right away
      return send(res, 200, data ?? { ok: true });
    } catch (e) {
      if (e instanceof UserError) return send(res, 400, { error: e.message, needsInput: e.exitCode === 2 });
      const err = e as Error & { code?: string };
      console.error(err);
      return send(res, 500, {
        error: err.code === 'ECONNREFUSED' ? 'Can\'t reach Postgres. Is the postgresql-x64-17 service running?' : 'Something went wrong on the server. Check the terminal running the dashboard.',
      });
    }
  }
  send(res, 404, { error: 'Not found' });
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  // Writes must be JSON: browsers can't send that cross-site without a preflight we never answer.
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new UserError('Expected a JSON body.');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new UserError('Request is too large.');
  }
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* fall through */ }
  throw new UserError('The request body isn\'t valid JSON.');
}

// ---------- live updates ----------
// The CLI and the dashboard both append to `events`, so a new max id means "something changed".

const clients = new Set<ServerResponse>();
let lastId = -1;
let pollTimer: NodeJS.Timeout | undefined;

async function poll() {
  try {
    const [row] = await sql<{ id: number }[]>`select coalesce(max(id), 0)::int as id from events`;
    if (row.id !== lastId) {
      lastId = row.id;
      for (const c of clients) c.write(`data: ${lastId}\n\n`);
    }
  } catch { /* Postgres down: keep the stream open, try again next tick */ }
}

function live(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`retry: 2000\ndata: ${lastId}\n\n`);
  clients.add(res);
  if (!pollTimer) pollTimer = setInterval(poll, 1000);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clients.delete(res);
    clearInterval(ping);
    if (!clients.size && pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
  });
}

// ---------- input helpers ----------

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string') throw new UserError(`${name} is missing.`);
  return v;
};
const optDay = (v: unknown, name: string): string | null => {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isoDate(startOfDay(v)) !== v) {
    throw new UserError(`${name} must be a date like 2026-11-23.`);
  }
  return v;
};
const minutesOf = (v: unknown, name: string): number => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 24 * 60) return v;
  if (typeof v === 'string') return parseDuration(v);
  throw new UserError(`${name} must be a duration like 1h30m.`);
};

function fieldsFrom(b: Record<string, unknown>): TicketFields {
  const f: TicketFields = {};
  if ('title' in b) f.title = cleanTitle(str(b.title, 'Title'));
  if ('notes' in b) f.notes = b.notes == null ? null : str(b.notes, 'Notes');
  if ('type' in b) f.type = parseType(str(b.type, 'Type'));
  if ('status' in b) f.status = parseStatus(str(b.status, 'Status'));
  if ('priority' in b) f.priority = parsePriority(str(b.priority, 'Priority'));
  if ('estimateMin' in b) f.estimateMin = b.estimateMin == null || b.estimateMin === '' ? null : minutesOf(b.estimateMin, 'Estimate');
  if ('dueOn' in b) f.dueOn = optDay(b.dueOn, 'Due date');
  if ('plannedOn' in b) f.plannedOn = optDay(b.plannedOn, 'Planned day');
  return f;
}

async function projectById(id: unknown): Promise<Project> {
  const p = (await listProjects()).find((x) => x.id === Number(id));
  if (!p) throw new UserError('Pick a project.');
  return p;
}

const keyParam = (s: string) => {
  if (!parseKey(s)) throw new UserError(`"${s}" isn't a ticket key.`);
  return s;
};

// ---------- shared reads ----------

async function openTickets() {
  return listTickets({ statuses: OPEN, limit: MAX });
}

async function timerJson() {
  const r = await runningTimer();
  if (!r) return null;
  return {
    startedAt: r.entry.startedAt, note: r.entry.note,
    project: { id: r.project.id, name: r.project.name, prefix: r.project.prefix, color: r.project.color },
    ticket: r.ticket ? { key: r.ticket.key, title: r.ticket.title } : null,
  };
}

async function withProgress(list: Ticket[]) {
  if (!list.length) return [];
  const rows = await db.select({ ticketId: schema.subtasks.ticketId, done: schema.subtasks.done }).from(schema.subtasks);
  const ids = new Set(list.map((t) => t.id));
  const prog = new Map<number, { done: number; total: number }>();
  for (const r of rows) {
    if (!ids.has(r.ticketId)) continue;
    const p = prog.get(r.ticketId) ?? { done: 0, total: 0 };
    p.total++; if (r.done) p.done++;
    prog.set(r.ticketId, p);
  }
  return list.map((t) => ({ ...t, subtasks: prog.get(t.id) ?? { done: 0, total: 0 } }));
}

// ---------- routes ----------

route('GET', '/api/summary', async () => {
  const day = today();
  const [projects, open, s, [{ n: all }], timer] = await Promise.all([
    listProjects(), openTickets(), getSettings(), db.select({ n: count() }).from(schema.tickets), timerJson(),
  ]);
  const ws = mondayOf(day);
  const [entries, plan] = await Promise.all([entriesBetween(ws, addDays(ws, 7)), getWeekPlan(day)]);
  const { totals } = await rangeTargets(ws, addDays(ws, 7), projects, s);
  const todayTargets = dayTargets(day, projects, s, plan);
  const todayLogged = entries.filter((e) => e.day === day).reduce((n, e) => n + e.minutes, 0);
  const byProject = sumBy(entries, (e) => e.projectId, (e) => e.minutes);
  return {
    today: day,
    timer,
    counts: {
      today: open.filter((t) => t.status === 'in_progress' || (t.plannedOn && t.plannedOn <= day)).length,
      open: open.length,
      all,
      inbox: open.filter((t) => t.status === 'inbox').length,
    },
    projects: projects.map((p) => ({
      id: p.id, name: p.name, prefix: p.prefix, color: p.color, isOverhead: p.isOverhead,
      open: open.filter((t) => t.projectId === p.id).length,
      loggedMin: byProject.get(p.id) ?? 0,
    })),
    week: {
      start: ws,
      loggedMin: entries.reduce((n, e) => n + e.minutes, 0),
      targetMin: [...totals.values()].reduce((a, b) => a + b, 0),
      todayLeftMin: Math.max(0, [...todayTargets.values()].reduce((a, b) => a + b, 0) - todayLogged),
    },
  };
});

route('GET', '/api/projects', async () => {
  const day = today();
  const ws = mondayOf(day);
  const [projects, s, all, entries] = await Promise.all([
    listProjects(), getSettings(), listTickets({ limit: MAX }), entriesBetween(ws, addDays(ws, 7)),
  ]);
  const { totals } = await rangeTargets(ws, addDays(ws, 7), projects, s);
  const byProject = sumBy(entries, (e) => e.projectId, (e) => e.minutes);
  const plannedPct = projects.filter((p) => !p.isOverhead).reduce((n, p) => n + p.weeklyPct, 0);
  return projects.map((p) => {
    const mine = all.filter((t) => t.projectId === p.id);
    const by = (st: TicketStatus) => mine.filter((t) => t.status === st).length;
    return {
      id: p.id, name: p.name, prefix: p.prefix, color: p.color, aliases: p.aliases, dirs: p.dirs,
      isOverhead: p.isOverhead,
      sharePct: p.isOverhead || !plannedPct ? 0 : (p.weeklyPct / plannedPct) * 100,
      weekTargetMin: totals.get(p.id) ?? 0, weekLoggedMin: byProject.get(p.id) ?? 0,
      counts: { inbox: by('inbox'), todo: by('todo'), in_progress: by('in_progress'), blocked: by('blocked'), done: by('done') },
      doneThisWeek: mine.filter((t) => t.doneAt && t.doneAt >= startOfDay(ws)).length,
    };
  });
});

route('GET', '/api/today', async () => {
  const day = today();
  const [projects, open, s, plan, timer, done] = await Promise.all([
    listProjects(), openTickets(), getSettings(), getWeekPlan(day), runningTimer(),
    listTickets({ doneBetween: { from: startOfDay(day), to: startOfDay(addDays(day, 1)) }, limit: MAX }),
  ]);
  const entries = await entriesBetween(day, addDays(day, 1));
  const logged = sumBy(entries, (e) => e.projectId, (e) => e.minutes);
  const targets = dayTargets(day, projects, s, plan);

  const rank = (t: Ticket) => ['urgent', 'high', 'normal', 'low'].indexOf(t.priority);
  const onToday = open.filter((t) => t.status === 'in_progress' || (t.plannedOn && t.plannedOn <= day) || (t.dueOn && t.dueOn <= day));
  onToday.sort((a, b) => Number(b.status === 'in_progress') - Number(a.status === 'in_progress') || rank(a) - rank(b));

  const focusTicket = timer?.ticket
    ?? onToday.find((t) => t.status === 'in_progress')
    ?? onToday.find((t) => t.status !== 'blocked');
  let focus = null;
  if (focusTicket) {
    const [subs, time] = await Promise.all([listSubtasks(focusTicket.id), ticketTime(focusTicket.id)]);
    focus = { ticket: focusTicket, subtasks: subs, loggedMin: time.minutes };
  }
  return {
    today: day,
    isWorkDay: s.workDays.includes(weekday(day)),
    focus,
    list: await withProgress(onToday.filter((t) => t.id !== focusTicket?.id)),
    done: await withProgress(done),
    plan: projects
      .map((p) => ({ id: p.id, name: p.name, prefix: p.prefix, color: p.color, targetMin: targets.get(p.id) ?? 0, loggedMin: logged.get(p.id) ?? 0 }))
      .filter((p) => p.targetMin > 0 || p.loggedMin > 0),
  };
});

route('GET', '/api/tickets', async ({ url }) => {
  const q = url.searchParams;
  const statuses = q.get('status')?.split(',').filter(Boolean).map(parseStatus);
  const types = q.get('type')?.split(',').filter(Boolean).map(parseType);
  const projectId = q.get('project') ? Number(q.get('project')) : undefined;
  let list = await listTickets({ statuses, types, projectId, limit: MAX });
  const doneDays = Number(q.get('doneDays'));
  if (doneDays > 0) {
    const since = startOfDay(addDays(today(), -doneDays));
    list = list.filter((t) => t.status !== 'done' || (t.doneAt && t.doneAt >= since));
  }
  const text = q.get('q')?.trim().toLowerCase();
  if (text) list = list.filter((t) => t.key.toLowerCase().includes(text) || t.title.toLowerCase().includes(text) || (t.notes ?? '').toLowerCase().includes(text));
  return withProgress(list);
});

route('POST', '/api/tickets', async ({ body }) => {
  const project = await projectById(body.projectId);
  const subs = Array.isArray(body.subtasks) ? body.subtasks.map((s) => str(s, 'Subtask')).filter((s) => s.trim()) : [];
  return createTicket(project.id, { ...fieldsFrom(body), title: str(body.title, 'Title'), subtasks: subs }, SRC);
});

route('GET', '/api/tickets/:key', async ({ params }) => {
  const t = await getTicket(keyParam(params[0]));
  const [subs, time, history] = await Promise.all([
    listSubtasks(t.id), ticketTime(t.id),
    db.select().from(schema.events).where(eq(schema.events.ticketId, t.id)).orderBy(desc(schema.events.id)).limit(30),
  ]);
  return { ticket: t, subtasks: subs, loggedMin: time.minutes, recent: time.recent, history };
});

route('PATCH', '/api/tickets/:key', async ({ params, body }) => (await updateTicket(keyParam(params[0]), fieldsFrom(body), SRC)).ticket);

route('POST', '/api/tickets/:key/move', async ({ params, body }) => {
  const p = await projectById(body.projectId);
  return moveTicket(keyParam(params[0]), p.prefix, SRC);
});

route('DELETE', '/api/tickets/:key', async ({ params }) => deleteTicket(keyParam(params[0]), SRC));

route('POST', '/api/tickets/:key/subtasks', async ({ params, body }) => {
  const titles = (Array.isArray(body.titles) ? body.titles : [body.title]).map((s) => str(s, 'Subtask')).filter((s) => s.trim());
  if (!titles.length) throw new UserError('Type a subtask first.');
  return addSubtasks(keyParam(params[0]), titles, SRC);
});

route('POST', '/api/tickets/:key/subtasks/:index', async ({ params, body }) => {
  const action = str(body.action, 'Action');
  if (!['done', 'undo', 'remove'].includes(action)) throw new UserError('Unknown subtask action.');
  return changeSubtask(keyParam(params[0]), Number(params[1]), action as 'done' | 'undo' | 'remove', SRC);
});

// ---------- time ----------

const targetOf = async (b: Record<string, unknown>) => {
  if (typeof b.key === 'string' && b.key) return resolveTarget(keyParam(b.key));
  return resolveTarget((await projectById(b.projectId)).prefix);
};

route('POST', '/api/timer/start', async ({ body }) => {
  const r = await startTimer(await targetOf(body), { note: typeof body.note === 'string' ? body.note : undefined, switch: body.switch === true }, SRC);
  return { startedAt: r.entry.startedAt, stoppedMin: r.stopped?.minutes ?? null };
});
route('POST', '/api/timer/stop', async ({ body }) => {
  const r = await stopTimer(typeof body.note === 'string' ? body.note : undefined, SRC);
  return { minutes: r.minutes };
});
route('POST', '/api/timer/cancel', async () => { await cancelTimer(SRC); });

route('POST', '/api/time', async ({ body }) => {
  const target = await targetOf(body);
  const minutes = minutesOf(body.duration, 'Duration');
  const day = optDay(body.day ?? today(), 'Day') ?? today();
  let start: Date;
  if (typeof body.at === 'string' && body.at) start = new Date(startOfDay(day).getTime() + parseClock(body.at) * 60_000);
  else if (day === today()) start = new Date(Date.now() - minutes * 60_000);
  else start = new Date(startOfDay(day).getTime() + 9 * 60 * 60_000);
  return logTime(target, start, minutes, typeof body.note === 'string' ? body.note : undefined, SRC);
});

// ---------- week plan ----------

route('GET', '/api/week', async ({ url }) => {
  const day = optDay(url.searchParams.get('day') ?? today(), 'Day') ?? today();
  const ws = mondayOf(day);
  const we = addDays(ws, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const [projects, s, plan, entries, planned, unplanned] = await Promise.all([
    listProjects(), getSettings(), getWeekPlan(ws), entriesBetween(ws, we),
    listTickets({ planned: { from: ws, to: addDays(ws, 6) }, limit: MAX }),
    listTickets({ planned: 'none', statuses: OPEN, limit: MAX }),
  ]);
  const logged = sumBy(entries, (e) => `${e.projectId}|${e.day}`, (e) => e.minutes);
  return {
    weekStart: ws, today: today(), days, weekHours: s.weekHours, workDays: s.workDays,
    saturdayHours: plan.saturdayHours, sundayHours: plan.sundayHours,
    projects: projects.map((p) => ({ id: p.id, name: p.name, prefix: p.prefix, color: p.color, isOverhead: p.isOverhead })),
    cells: days.map((d) => {
      const t = dayTargets(d, projects, s, plan);
      return projects.map((p) => ({ projectId: p.id, targetMin: t.get(p.id) ?? 0, loggedMin: logged.get(`${p.id}|${d}`) ?? 0 }));
    }),
    planned: await withProgress(planned),
    unplanned: await withProgress(unplanned),
  };
});

route('POST', '/api/week/weekend', async ({ body }) => {
  const day = optDay(body.day, 'Week') ?? today();
  return setWeekend(day, Number(body.saturdayHours ?? 0), Number(body.sundayHours ?? 0), SRC);
});

// ---------- reports ----------

route('GET', '/api/reports', async ({ url }) => {
  const period = url.searchParams.get('period') === 'month' ? 'month' : 'week';
  const anchor = optDay(url.searchParams.get('day') ?? today(), 'Day') ?? today();
  let from: string, to: string;
  if (period === 'week') { from = mondayOf(anchor); to = addDays(from, 7); }
  else {
    from = `${anchor.slice(0, 7)}-01`;
    const d = startOfDay(from); d.setMonth(d.getMonth() + 1); to = isoDate(d);
  }
  const [projects, s, shipped, entries, created] = await Promise.all([
    listProjects(), getSettings(),
    listTickets({ doneBetween: { from: startOfDay(from), to: startOfDay(to) }, limit: MAX }),
    entriesBetween(from, to),
    // Tickets created in the range that still exist, so deleted ones don't inflate the count.
    db.select({ n: count() }).from(schema.tickets).where(and(
      gte(schema.tickets.createdAt, startOfDay(from)), lt(schema.tickets.createdAt, startOfDay(to)),
    )),
  ]);
  const { totals, weekend: weekendTargets } = await rangeTargets(from, to, projects, s);
  const isWeekend = (d: string) => [0, 6].includes(weekday(d));
  const weekdayLogged = sumBy(entries.filter((e) => !isWeekend(e.day)), (e) => e.projectId, (e) => e.minutes);
  const weekendLogged = sumBy(entries.filter((e) => isWeekend(e.day)), (e) => e.projectId, (e) => e.minutes);
  const daily = sumBy(entries, (e) => e.day, (e) => e.minutes);
  const days: { day: string; minutes: number }[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push({ day: d, minutes: daily.get(d) ?? 0 });
  return {
    period, from, to, today: today(),
    created: created[0].n,
    shipped,
    days,
    projects: projects.map((p) => ({
      id: p.id, name: p.name, prefix: p.prefix, color: p.color, isOverhead: p.isOverhead,
      targetMin: totals.get(p.id) ?? 0, weekendTargetMin: weekendTargets.get(p.id) ?? 0,
      weekdayMin: weekdayLogged.get(p.id) ?? 0, weekendMin: weekendLogged.get(p.id) ?? 0,
      shipped: shipped.filter((t) => t.projectId === p.id).length,
    })),
  };
});
