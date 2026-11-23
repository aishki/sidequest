#!/usr/bin/env node
// tt: the sidequest command line. /t calls this; it never writes SQL itself.
// Exit codes: 0 ok, 1 bad input or error, 2 needs the user to choose (e.g. an ambiguous project).
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { eq } from 'drizzle-orm';
import { db, sql, schema } from '../core/db.ts';
import {
  addDays, fmtClock, fmtDay, fmtMin, label, parseClock, parseDay, parseDayOrNone, parseDuration, parsePriority,
  parseStatus, parseType, startOfDay, today, UserError, STATUSES, type TicketStatus,
} from '../core/parse.ts';
import { linkDir, listProjects, matchProject, normDir, projectForDir, unlinkDir } from '../core/projects.ts';
import {
  addSubtasks, changeSubtask, createTicket, deleteTicket, getTicket, listSubtasks, listTickets, moveTicket,
  updateTicket, type Ticket, type TicketFields,
} from '../core/tickets.ts';
import {
  cancelTimer, getWeekPlan, logTime, minutesByProject, resolveTarget, runningTimer, setWeekend, startTimer, stopTimer,
  ticketTime, timerLabel,
} from '../core/time.ts';

const SRC = 'cli' as const;
const argv = process.argv.slice(2);
const json = argv.includes('--json');
const args = argv.filter((a) => a !== '--json');

const out = (text: string, data: unknown) => console.log(json ? JSON.stringify(data, null, 2) : text);

function parse<O extends NonNullable<ParseArgsConfig['options']>>(rest: string[], options: O) {
  try {
    return parseArgs({ args: rest, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UserError((e as Error).message.replace(/\. To specify a positional.*$/s, '.'));
  }
}

// ---------- formatting ----------

function ticketLine(t: Ticket): string {
  const meta = [
    t.priority !== 'normal' ? t.priority : '',
    t.estimateMin ? `est ${fmtMin(t.estimateMin)}` : '',
    t.plannedOn ? `plan ${fmtDay(t.plannedOn)}` : '',
    t.dueOn ? `due ${fmtDay(t.dueOn)}` : '',
  ].filter(Boolean).join(' · ');
  return `${t.key.padEnd(8)} ${label(t.status).padEnd(12)} ${label(t.type).padEnd(12)} ${t.title}${meta ? `  (${meta})` : ''}`;
}

const ticketFieldOptions = {
  title: { type: 'string' }, notes: { type: 'string' }, 'add-note': { type: 'string' },
  type: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string' },
  estimate: { type: 'string' }, due: { type: 'string' }, plan: { type: 'string' },
} as const;

function fieldsFrom(v: Record<string, string | boolean | (string | boolean)[] | undefined>): TicketFields {
  const s = (k: string) => v[k] as string | undefined;
  const f: TicketFields = {};
  if (s('title') !== undefined) f.title = s('title');
  if (s('notes') !== undefined) f.notes = s('notes');
  if (s('type')) f.type = parseType(s('type')!);
  if (s('status')) f.status = parseStatus(s('status')!);
  if (s('priority')) f.priority = parsePriority(s('priority')!);
  if (s('estimate')) f.estimateMin = ['none', 'clear', '-'].includes(s('estimate')!.toLowerCase()) ? null : parseDuration(s('estimate')!);
  if (s('due')) f.dueOn = parseDayOrNone(s('due')!, 'future');
  if (s('plan')) f.plannedOn = parseDayOrNone(s('plan')!, 'future');
  return f;
}

function describeChanges(changes: Record<string, { from: unknown; to: unknown }>): string {
  const show = (field: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'estimateMin') return fmtMin(v as number);
    if (field === 'dueOn' || field === 'plannedOn') return fmtDay(v as string);
    if (field === 'notes') return `"${String(v).slice(0, 40)}${String(v).length > 40 ? '…' : ''}"`;
    return ['type', 'status', 'priority'].includes(field) ? label(String(v)) : String(v);
  };
  const names: Record<string, string> = { estimateMin: 'estimate', dueOn: 'due', plannedOn: 'planned' };
  return Object.entries(changes).map(([f, c]) => `  ${names[f] ?? f}: ${show(f, c.from)} → ${show(f, c.to)}`).join('\n');
}

// ---------- commands ----------

const HELP = `tt — sidequest ticket tracker

Tickets
  tt add <project> <title> [--type T] [--priority P] [--status S] [--estimate 2h]
                           [--due DAY] [--plan DAY] [--notes TEXT] [--sub TEXT ...]
  tt update <KEY> [--title T] [--type T] [--status S] [--priority P] [--estimate 2h|none]
                  [--due DAY|none] [--plan DAY|none] [--notes TEXT] [--add-note TEXT]
  tt done <KEY>                     mark done
  tt move <KEY> <project>           new key in the other project
  tt delete <KEY> --yes
  tt show <KEY>
  tt list [project] [--status open|all|S,S] [--type T,T] [--plan today|week|none|DAY] [--limit N]
  tt today

Subtasks
  tt sub add <KEY> <text> [text ...]
  tt sub done|undo|rm <KEY> <n>

Time
  tt log <KEY|project> <duration> [--on DAY] [--at 14:00] [--note TEXT]     (alias: spent)
  tt timer start <KEY|project> [--note TEXT] [--switch]
  tt timer stop [--note TEXT] | tt timer cancel | tt timer

Projects
  tt projects
  tt resolve <name>                 which project a name means (exit 2 = ask the user)
  tt link <project> [--dir PATH]    "this" in that folder means that project
  tt unlink [--dir PATH]
  tt here                           project linked to the current folder

Planning
  tt weekend <sat-hours> <sun-hours> [--week DAY]   opt one week in to weekend hours (0 0 = off)

project: prefix (WEB), alias (web, site), full name, or "this" for the current folder.
DAY: today, tomorrow, yesterday, mon..sun, or YYYY-MM-DD.
Types: feature, bug, ui/ux, update, launch film, research, admin.
Status: inbox, todo, in progress, blocked, done. Priority: low, normal, high, urgent.
Add --json to any command for machine-readable output.`;

const commands: Record<string, (rest: string[]) => Promise<void>> = {
  async help() { console.log(HELP); },

  async projects() {
    const list = await listProjects();
    const cwdProject = projectForDir(process.cwd(), list);
    const totalPct = list.reduce((s, p) => s + p.weeklyPct, 0) || 1;
    const weekHours = Number((await getSetting('weekHours')) ?? 40);
    const lines = list.map((p) => {
      const hours = p.isOverhead ? 'not planned' : `${((p.weeklyPct / totalPct) * weekHours).toFixed(1)}h/wk`;
      const extra = [p.aliases.length ? `aka ${p.aliases.join(', ')}` : '', p.dirs.length ? `folders: ${p.dirs.join(', ')}` : '']
        .filter(Boolean).join(' · ');
      return `${p.prefix.padEnd(5)} ${p.name.padEnd(26)} ${hours.padEnd(12)} next ${p.prefix}-${String(p.nextNumber).padStart(3, '0')}${p.id === cwdProject?.id ? '  ← this folder' : ''}\n      ${extra}`;
    });
    out(lines.join('\n'), list);
  },

  async resolve(rest) {
    const { positionals } = parse(rest, {});
    if (!positionals.length) throw new UserError('Usage: tt resolve <name>');
    const p = matchProject(positionals.join(' '), await listProjects());
    out(`${p.prefix} ${p.name}`, p);
  },

  async here() {
    const p = projectForDir(process.cwd(), await listProjects());
    if (!p) throw new UserError(`${normDir(process.cwd())} isn't linked to a project. Run: tt link <project>`, 2);
    out(`${p.prefix} ${p.name}`, p);
  },

  async link(rest) {
    const { values, positionals } = parse(rest, { dir: { type: 'string' } });
    if (!positionals.length) throw new UserError('Usage: tt link <project> [--dir PATH]');
    const r = await linkDir(positionals.join(' '), values.dir ?? process.cwd(), SRC);
    const text = !r.changed ? `${r.dir} was already linked to ${r.project.prefix} ${r.project.name}.`
      : `Linked ${r.dir} → ${r.project.prefix} ${r.project.name}${r.previous ? ` (was ${r.previous.prefix})` : ''}.`;
    out(text, r);
  },

  async unlink(rest) {
    const { values } = parse(rest, { dir: { type: 'string' } });
    const r = await unlinkDir(values.dir ?? process.cwd(), SRC);
    out(`Unlinked ${r.dir} from ${r.project.prefix} ${r.project.name}.`, r);
  },

  async add(rest) {
    const { values, positionals } = parse(rest, { ...ticketFieldOptions, sub: { type: 'string', multiple: true } });
    if (positionals.length < 2) throw new UserError('Usage: tt add <project> <title> [options]. Quote the title.');
    if (values['add-note']) throw new UserError('Use --notes when adding a ticket.');
    const project = matchProject(positionals[0], await listProjects());
    if (project.archivedAt) throw new UserError(`${project.name} is archived.`);
    const fields = fieldsFrom(values);
    const t = await createTicket(project.id, { ...fields, title: positionals.slice(1).join(' '), subtasks: values.sub }, SRC);
    const subs = values.sub?.length ? `\n  + ${values.sub.length} subtask${values.sub.length === 1 ? '' : 's'}` : '';
    out(`Created ${t.key} in ${t.projectName}\n${ticketLine(t)}${subs}`, t);
  },

  async update(rest) {
    const { values, positionals } = parse(rest, ticketFieldOptions);
    if (positionals.length !== 1) throw new UserError('Usage: tt update <KEY> [options]');
    const fields = fieldsFrom(values);
    if (values['add-note']) {
      if (fields.notes !== undefined) throw new UserError('Use either --notes (replace) or --add-note (append), not both.');
      const t = await getTicket(positionals[0]);
      fields.notes = [t.notes, values['add-note']].filter(Boolean).join('\n');
    }
    if (!Object.keys(fields).length) throw new UserError('Nothing to change. Pass at least one option, e.g. --status done.');
    const { ticket, changes } = await updateTicket(positionals[0], fields, SRC);
    const text = Object.keys(changes).length ? `Updated ${ticket.key} ${ticket.title}\n${describeChanges(changes)}`
      : `${ticket.key} already had those values; nothing changed.`;
    out(text, { ticket, changes });
  },

  async done(rest) {
    const { positionals } = parse(rest, {});
    if (!positionals.length) throw new UserError('Usage: tt done <KEY> [KEY ...]');
    const results = [];
    for (const key of positionals) results.push(await updateTicket(key, { status: 'done' }, SRC));
    const text = results.map(({ ticket, changes }) =>
      changes.status ? `Done: ${ticket.key} ${ticket.title}` : `${ticket.key} was already done.`).join('\n');
    out(text, results);
  },

  async move(rest) {
    const { positionals } = parse(rest, {});
    if (positionals.length < 2) throw new UserError('Usage: tt move <KEY> <project>');
    const r = await moveTicket(positionals[0], positionals.slice(1).join(' '), SRC);
    out(r.from === r.ticket.key ? `${r.from} is already in ${r.ticket.projectName}.`
      : `Moved ${r.from} → ${r.ticket.key} (${r.ticket.projectName}). Its logged time moved too.`, r);
  },

  async delete(rest) {
    const { values, positionals } = parse(rest, { yes: { type: 'boolean' } });
    if (positionals.length !== 1) throw new UserError('Usage: tt delete <KEY> --yes');
    if (!values.yes) {
      const t = await getTicket(positionals[0]);
      throw new UserError(`This deletes ${t.key} "${t.title}" and its subtasks. Confirm with the user, then re-run with --yes.`, 2);
    }
    const t = await deleteTicket(positionals[0], SRC);
    out(`Deleted ${t.key} ${t.title}. Its logged time stays on ${t.projectName}.`, t);
  },

  async show(rest) {
    const { positionals } = parse(rest, {});
    if (positionals.length !== 1) throw new UserError('Usage: tt show <KEY>');
    const t = await getTicket(positionals[0]);
    const [subs, time] = await Promise.all([listSubtasks(t.id), ticketTime(t.id)]);
    const lines = [
      `${t.key}  ${t.title}`,
      `  project   ${t.projectName}`,
      `  status    ${label(t.status)}${t.doneAt ? ` (${fmtDay(isoLocal(t.doneAt))})` : ''}`,
      `  type      ${label(t.type)}`,
      `  priority  ${t.priority}`,
      t.estimateMin ? `  estimate  ${fmtMin(t.estimateMin)}` : '',
      t.plannedOn ? `  planned   ${fmtDay(t.plannedOn)}` : '',
      t.dueOn ? `  due       ${fmtDay(t.dueOn)}` : '',
      `  logged    ${fmtMin(time.minutes)}${t.estimateMin ? ` of ${fmtMin(t.estimateMin)}` : ''}`,
      `  created   ${fmtDay(isoLocal(t.createdAt))}`,
      t.notes ? `  notes     ${t.notes.replace(/\n/g, '\n            ')}` : '',
      subs.length ? `  subtasks  (${subs.filter((s) => s.done).length}/${subs.length})` : '',
      ...subs.map((s, i) => `    ${i + 1}. [${s.done ? 'x' : ' '}] ${s.title}`),
    ].filter(Boolean);
    out(lines.join('\n'), { ...t, subtasks: subs, loggedMinutes: time.minutes, recentTime: time.recent });
  },

  async list(rest) {
    const { values, positionals } = parse(rest, {
      status: { type: 'string' }, type: { type: 'string' }, plan: { type: 'string' }, limit: { type: 'string' },
    });
    const projectId = positionals.length ? matchProject(positionals.join(' '), await listProjects()).id : undefined;
    const st = (values.status ?? 'open').toLowerCase();
    const statuses: TicketStatus[] = st === 'all' ? [...STATUSES]
      : st === 'open' ? STATUSES.filter((s) => s !== 'done')
      : st.split(',').map(parseStatus);
    const types = values.type?.split(',').map(parseType);
    let planned: { from: string; to: string } | 'none' | undefined;
    if (values.plan) {
      const p = values.plan.toLowerCase();
      if (p === 'none') planned = 'none';
      else if (p === 'week') { const mon = addDays(today(), -((new Date().getDay() + 6) % 7)); planned = { from: mon, to: addDays(mon, 6) }; }
      else { const d = parseDay(p, 'future'); planned = { from: d, to: d }; }
    }
    const limit = values.limit ? Number(values.limit) : 100;
    if (!Number.isInteger(limit) || limit < 1) throw new UserError('--limit must be a whole number above 0.');
    const rows = await listTickets({ projectId, statuses, types, planned, limit });
    out(rows.length ? rows.map(ticketLine).join('\n') + `\n(${rows.length} ticket${rows.length === 1 ? '' : 's'})` : 'No tickets match.', rows);
  },

  async today() {
    const d = today();
    const [planned, all, logged, timer, week] = await Promise.all([
      listTickets({ planned: { from: d, to: d }, statuses: STATUSES.filter((s) => s !== 'done') }),
      listTickets({ statuses: ['in_progress', 'blocked', 'todo', 'inbox'] }),
      minutesByProject(d, addDays(d, 1)),
      runningTimer(),
      getWeekPlan(d),
    ]);
    const plannedIds = new Set(planned.map((t) => t.id));
    const inProgress = all.filter((t) => t.status === 'in_progress' && !plannedIds.has(t.id));
    const overdue = all.filter((t) => t.dueOn && t.dueOn <= d && !plannedIds.has(t.id) && t.status !== 'in_progress');
    const doneToday = await listTickets({ statuses: ['done'], doneBetween: { from: startOfDay(d), to: startOfDay(addDays(d, 1)) } });
    const wd = new Date().getDay();
    const weekendNote = wd === 6 || wd === 0
      ? `\nWeekend: ${(wd === 6 ? week.saturdayHours : week.sundayHours) ? `${wd === 6 ? week.saturdayHours : week.sundayHours}h planned` : 'no hours planned (log time any time)'}` : '';
    const total = logged.reduce((s, r) => s + r.minutes, 0);
    const byProject = logged.filter((r) => r.minutes >= 0.5); // hide timers stopped within seconds
    const lines = [
      `Today, ${fmtDay(d)}${weekendNote}`,
      timer ? `\n⏱ Timer: ${timerLabel(timer)} — ${fmtMin(timer.minutes)} (since ${fmtClock(timer.entry.startedAt)})` : '',
      `\nPlanned (${planned.length})`, ...(planned.length ? planned.map(ticketLine) : ['  nothing planned']),
      inProgress.length ? `\nIn progress` : '', ...inProgress.map(ticketLine),
      overdue.length ? `\nDue or overdue` : '', ...overdue.map(ticketLine),
      doneToday.length ? `\nDone today` : '', ...doneToday.map(ticketLine),
      `\nLogged today: ${fmtMin(total)}${byProject.length ? ` (${byProject.map((r) => `${r.prefix} ${fmtMin(r.minutes)}`).join(', ')})` : ''}`,
    ].filter(Boolean);
    out(lines.join('\n'), { date: d, timer, planned, inProgress, overdue, doneToday, logged, loggedMinutes: total, week });
  },

  async log(rest) {
    const { values, positionals } = parse(rest, { on: { type: 'string' }, at: { type: 'string' }, note: { type: 'string' } });
    if (positionals.length < 2) throw new UserError('Usage: tt log <KEY|project> <duration> [--on DAY] [--at 14:00] [--note TEXT]');
    const minutes = parseDuration(positionals[positionals.length - 1]);
    const target = await resolveTarget(positionals.slice(0, -1).join(' '));
    const day = values.on ? parseDay(values.on, 'past') : today();
    let start: Date;
    if (values.at) {
      start = new Date(startOfDay(day).getTime() + parseClock(values.at) * 60_000);
    } else if (day === today()) {
      start = new Date(Date.now() - minutes * 60_000); // just finished
    } else {
      start = new Date(startOfDay(day).getTime() + 9 * 60 * 60_000); // a past day with no time: from 09:00
    }
    const entry = await logTime(target, start, minutes, values.note, SRC);
    const what = target.ticket ? `${target.ticket.key} ${target.ticket.title}` : target.project.name;
    const wd = startOfDay(day).getDay();
    const weekend = wd === 0 || wd === 6 ? ' (weekend)' : '';
    out(`Logged ${fmtMin(minutes)} on ${what}, ${fmtDay(day)}${weekend} ${fmtClock(entry.startedAt)}–${fmtClock(entry.endedAt!)}`, entry);
  },

  async timer(rest) {
    const [sub = 'status', ...more] = rest;
    if (sub === 'start') {
      const { values, positionals } = parse(more, { note: { type: 'string' }, switch: { type: 'boolean' } });
      if (!positionals.length) throw new UserError('Usage: tt timer start <KEY|project> [--note TEXT] [--switch]');
      const target = await resolveTarget(positionals.join(' '));
      const r = await startTimer(target, { note: values.note, switch: values.switch }, SRC);
      const what = target.ticket ? `${target.ticket.key} ${target.ticket.title}` : target.project.name;
      const lines = [
        r.stopped ? `Stopped ${timerLabel(r.stopped.timer)} after ${fmtMin(r.stopped.minutes)}.` : '',
        `Timer started on ${what} at ${fmtClock(r.entry.startedAt)}.`,
        r.movedToInProgress ? `${target.ticket!.key} is now in progress.` : '',
      ].filter(Boolean);
      return out(lines.join('\n'), r);
    }
    if (sub === 'stop') {
      const { values } = parse(more, { note: { type: 'string' } });
      const r = await stopTimer(values.note, SRC);
      return out(`Stopped ${timerLabel(r.timer)} after ${fmtMin(r.minutes)}.`, r);
    }
    if (sub === 'cancel') {
      const r = await cancelTimer(SRC);
      return out(`Cancelled the timer on ${timerLabel(r)} (${fmtMin(r.minutes)} not logged).`, r);
    }
    if (sub === 'status') {
      const r = await runningTimer();
      return out(r ? `⏱ ${timerLabel(r)} — ${fmtMin(r.minutes)} (since ${fmtClock(r.entry.startedAt)})` : 'No timer running.', r ?? null);
    }
    throw new UserError('Usage: tt timer start|stop|cancel|status');
  },

  async sub(rest) {
    const [action, key, ...more] = rest;
    if (!action || !key) throw new UserError('Usage: tt sub add <KEY> <text> [text ...] | tt sub done|undo|rm <KEY> <n>');
    if (action === 'add') {
      if (!more.length) throw new UserError('Usage: tt sub add <KEY> <text> [text ...]');
      const r = await addSubtasks(key, more, SRC);
      return out(`Added ${more.length} subtask${more.length === 1 ? '' : 's'} to ${r.ticket.key}:\n` +
        r.subtasks.map((s, i) => `  ${i + 1}. [${s.done ? 'x' : ' '}] ${s.title}`).join('\n'), r);
    }
    const map = { done: 'done', undo: 'undo', rm: 'remove', remove: 'remove' } as const;
    const act = map[action as keyof typeof map];
    if (!act) throw new UserError(`Unknown subtask action "${action}". Use add, done, undo or rm.`);
    const n = Number(more[0]);
    if (!Number.isInteger(n) || n < 1) throw new UserError(`Which subtask? Give its number from tt show ${key}.`);
    const r = await changeSubtask(key, n, act, SRC);
    const verb = act === 'done' ? 'Checked off' : act === 'undo' ? 'Unchecked' : 'Removed';
    const left = r.subtasks.filter((s) => !s.done).length;
    out(`${verb} "${r.subtask.title}" on ${r.ticket.key}. ${left} of ${r.subtasks.length} left.`, r);
  },

  async weekend(rest) {
    const { values, positionals } = parse(rest, { week: { type: 'string' } });
    let sat: number, sun: number;
    if (positionals.length === 1 && positionals[0].toLowerCase() === 'off') [sat, sun] = [0, 0];
    else if (positionals.length === 2) [sat, sun] = positionals.map((p) => Number(p.replace(/h$/i, '')));
    else throw new UserError('Usage: tt weekend <saturday-hours> <sunday-hours> [--week DAY], or tt weekend off');
    if ([sat, sun].some((h) => Number.isNaN(h))) throw new UserError('Hours must be numbers, e.g. tt weekend 4 0.');
    const r = await setWeekend(values.week ? parseDay(values.week, 'future') : today(), sat, sun, SRC);
    const day = (h: number, iso: string) => h ? `${h}h on ${fmtDay(iso)}` : `${fmtDay(iso)} off`;
    out(sat || sun
      ? `Week of ${fmtDay(r.weekStart)}: planning ${day(sat, r.saturday)}, ${day(sun, r.sunday)}.`
      : `Week of ${fmtDay(r.weekStart)}: no weekend hours planned.`, r);
  },
};

const ALIASES: Record<string, string> = {
  spent: 'log', edit: 'update', ls: 'list', rm: 'delete', new: 'add', '-h': 'help', '--help': 'help', project: 'projects',
};

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getSetting(key: string): Promise<unknown> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return row?.value;
}

async function main() {
  const [name = 'help', ...rest] = args;
  const cmd = commands[ALIASES[name] ?? name];
  if (!cmd) throw new UserError(`Unknown command "${name}". Run tt help.`);
  const tz = await getSetting('timezone').catch(() => undefined);
  if (typeof tz === 'string' && tz !== 'auto') process.env.TZ = tz;
  await cmd(rest);
}

try {
  await main();
} catch (e) {
  if (e instanceof UserError) {
    console.error(json ? JSON.stringify({ error: e.message, needsInput: e.exitCode === 2 }) : e.message);
    process.exitCode = e.exitCode;
  } else {
    const err = e as Error & { code?: string };
    console.error(err.code === 'ECONNREFUSED'
      ? 'Can\'t reach Postgres. Is the postgresql-x64-17 service running?'
      : `Unexpected error: ${err.message}`);
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 2 });
}
