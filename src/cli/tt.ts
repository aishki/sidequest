#!/usr/bin/env node
// tt: the sidequest command line. /t calls this; it never writes SQL itself.
// Exit codes: 0 ok, 1 bad input or error, 2 needs the user to choose (e.g. an ambiguous project).
import { fileURLToPath } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { sql } from '../core/db.ts';
import {
  addDays, fmtClock, fmtDay, fmtMin, fmtWorkDays, label, mondayOf, parseClock, parseDay, parseDayOrNone, parseDuration,
  parseHours, parsePriority, parseStatus, parseType, parseWorkDays, startOfDay, today, UserError, STATUSES,
  type TicketStatus,
} from '../core/parse.ts';
import {
  buildReport, draftSummary, getSummary, parsePeriod, periodLabel, periodRange, saveSummary, summaryFacts,
} from '../core/reports.ts';
import {
  applyTimezone, clearWeekShares, dayHours, defaultShares, effectiveShares, getSettings, getWeekPlan, setSettings,
  setShare, setWeekend, type SettingsPatch, type WeekendDay,
} from '../core/planning.ts';
import { addProject, linkDir, listProjects, matchProject, normDir, projectForDir, unlinkDir } from '../core/projects.ts';
import {
  addSubtasks, changeSubtask, createTicket, deleteTicket, getTicket, listSubtasks, listTickets, moveTicket,
  updateTicket, type Ticket, type TicketFields,
} from '../core/tickets.ts';
import {
  cancelTimer, logTime, minutesByProject, resolveTarget, runningTimer, startTimer, stopTimer, ticketTime, timerLabel,
} from '../core/time.ts';

const SRC = 'cli' as const;
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const argv = process.argv.slice(2);
const json = argv.includes('--json');
const args = argv.filter((a) => a !== '--json');

async function readStdin(): Promise<string> {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

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
  tt projects add <name> --prefix WEB [--alias site] [--share 30] [--color #hex] [--overhead]
  tt resolve <name>                 which project a name means (exit 2 = ask the user)
  tt link <project> [--dir PATH]    "this" in that folder means that project
  tt unlink [--dir PATH]
  tt here                           project linked to the current folder

Planning
  tt share                          how the week is split, in % and hours
  tt share <project> <pct> [--week DAY]   change one share; the others scale to fit
                                    (--week: that week only; without it: every week)
  tt share reset --week DAY         that week goes back to the usual split
  tt settings [--hours 40] [--days mon-fri] [--meetings 3h]
  tt weekend sat|sun <hours|off> [--on project] [--week DAY]
  tt weekend <sat-hours> <sun-hours> [--on project] [--week DAY]
  tt weekend off [--week DAY]       weekend hours count for that one week only

Reports
  tt report [week|month|quarter] [--day DAY]     the numbers: hours vs plan, shipped, on time
  tt summary [week|month|quarter] [--day DAY]    the written update for that period
  tt summary save [period] [--day DAY] [--text TEXT]   save it (text from --text or stdin)
  tt summary draft [period] [--day DAY]          let Claude Code draft it (runs claude -p)
  tt summary clear [period] [--day DAY]

project: prefix (WEB), alias (web, site), full name, or "this" for the current folder.
DAY: today, tomorrow, yesterday, mon..sun, or YYYY-MM-DD.
Types: feature, bug, ui/ux, update, launch film, research, admin.
Status: inbox, todo, in progress, blocked, done. Priority: low, normal, high, urgent.
Add --json to any command for machine-readable output.`;

const commands: Record<string, (rest: string[]) => Promise<void>> = {
  async help() { console.log(`${HELP}\n\nInstalled at ${ROOT}. Check the setup with: npm run setup`); },

  async projects(rest) {
    if (rest[0] === 'add') return addProjectCmd(rest.slice(1));
    if (rest.length) throw new UserError('Usage: tt projects, or tt projects add <name> --prefix P');
    const [list, s] = await Promise.all([listProjects(), getSettings()]);
    const cwdProject = projectForDir(process.cwd(), list);
    const usual = defaultShares(list);
    const focusHours = Math.max(0, s.weekHours - s.meetingHours);
    const lines = list.map((p) => {
      const hours = p.isOverhead ? 'not planned' : `${(((usual.get(p.id) ?? 0) / 100) * focusHours).toFixed(1)}h/wk`;
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

  async share(rest) {
    const { values, positionals } = parse(rest, { week: { type: 'string' } });
    const week = values.week ? parseDay(values.week, 'future') : undefined;
    if (positionals[0]?.toLowerCase() === 'reset') {
      if (!week) throw new UserError('Which week? tt share reset --week DAY. To change the usual split, set a share without --week.');
      const r = await clearWeekShares(week, SRC);
      return out(`Week of ${fmtDay(r.weekStart)} is back on the usual split.`, r);
    }
    let note = '';
    if (positionals.length >= 2) {
      const pctText = positionals.at(-1)!;
      if (!/^\d+(\.\d+)?%?$/.test(pctText)) throw new UserError(`"${pctText}" isn't a percent. Use a number like 30 or 30%.`);
      const pct = Number(pctText.replace(/%$/, ''));
      const r = await setShare(positionals.slice(0, -1).join(' '), pct, { week }, SRC);
      const scope = week ? `the week of ${fmtDay(mondayOf(week))} only` : 'every week';
      note = `${r.project.name} is now ${pct}% (${scope}). The other projects scaled to fit.`;
    } else if (positionals.length === 1) {
      throw new UserError('Usage: tt share <project> <pct> [--week DAY], e.g. tt share web 40');
    }
    await showShares(week ?? today(), note);
  },

  async settings(rest) {
    const { values } = parse(rest, { hours: { type: 'string' }, days: { type: 'string' }, meetings: { type: 'string' } });
    const patch: SettingsPatch = {};
    if (values.hours) patch.weekHours = parseHours(values.hours);
    if (values.days) patch.workDays = parseWorkDays(values.days);
    if (values.meetings) patch.meetingHours = ['none', '0', 'off'].includes(values.meetings.toLowerCase()) ? 0 : parseHours(values.meetings);
    const changed = Object.keys(patch).length > 0;
    const s = changed ? await setSettings(patch, SRC) : await getSettings();
    const focus = Math.max(0, s.weekHours - s.meetingHours);
    out([
      changed ? 'Saved.\n' : '',
      `Week:      ${s.weekHours}h`,
      `Work days: ${fmtWorkDays(s.workDays)}`,
      `Meetings:  ${s.meetingHours ? `${s.meetingHours}h a week` : 'none'}`,
      `Planned:   ${focus}h of project work, ${+(focus / s.workDays.length).toFixed(2)}h a day`,
    ].filter(Boolean).join('\n'), s);
  },

  async report(rest) {
    const { values, positionals } = parse(rest, { day: { type: 'string' } });
    const r = await buildReport(parsePeriod(positionals[0]), values.day ? parseDay(values.day, 'past') : today());
    const s = r.stats;
    const extra = [
      s.dueCount ? `On time: ${s.onTimeCount} of ${s.dueCount} with a due date` : '',
      s.avgDaysToDone != null ? `Start to done: ${s.avgDaysToDone.toFixed(1)} days on average` : '',
      s.launchFilms ? `Launch films: ${s.launchFilms}` : '',
    ].filter(Boolean);
    const summary = r.summary ? `\n\nSummary (${r.summary.author === 'claude' ? 'drafted by Claude' : 'edited'}):\n${r.summary.body}` : '\n\nNo written summary yet.';
    out(`${summaryFacts(r)}${extra.length ? `\n\n${extra.join('\n')}` : ''}${summary}`, r);
  },

  async summary(rest) {
    const { values, positionals } = parse(rest, { day: { type: 'string' }, text: { type: 'string' } });
    const action = ['save', 'draft', 'clear', 'show'].includes(positionals[0]?.toLowerCase()) ? positionals.shift()!.toLowerCase() : 'show';
    const period = parsePeriod(positionals[0]);
    const day = values.day ? parseDay(values.day, 'past') : today();
    const { from, to } = periodRange(period, day);
    const name = periodLabel(period, from, to);
    if (action === 'show') {
      const s = await getSummary(period, from);
      return out(s ? `${name}\n\n${s.body}` : `No summary for ${name} yet. Write one with tt summary save, or tt summary draft.`, { period, from, summary: s });
    }
    if (action === 'draft') {
      const r = await draftSummary(period, day, SRC);
      return out(`${name}\n\n${r.summary!.body}\n\nSaved. Edit it on the Reports screen or with tt summary save.`, r);
    }
    let text = '';
    if (action === 'save') {
      text = values.text ?? (process.stdin.isTTY ? '' : await readStdin());
      if (!text.trim()) throw new UserError('No text. Use --text "…" or pipe the summary in.');
    }
    const r = await saveSummary(period, day, text, 'claude', SRC);
    out(r.summary ? `Saved the summary for ${name}.` : `Removed the summary for ${name}.`, r);
  },

  async weekend(rest) {
    const { values, positionals } = parse(rest, { week: { type: 'string' }, on: { type: 'string' } });
    const day = values.week ? parseDay(values.week, 'future') : today();
    const projectId = values.on ? matchProject(values.on, await listProjects()).id : undefined;
    const hours = (t: string) => (['off', 'none', '0'].includes(t.toLowerCase()) ? 0 : parseHours(t));
    const side = (h: number): WeekendDay => ({ hours: h, projectId: h ? projectId : null });
    const which = positionals[0]?.toLowerCase() ?? '';
    let change: { saturday?: WeekendDay; sunday?: WeekendDay };
    if (positionals.length === 1 && which === 'off') change = { saturday: side(0), sunday: side(0) };
    else if (positionals.length === 2 && /^sat(urday)?$/.test(which)) change = { saturday: side(hours(positionals[1])) };
    else if (positionals.length === 2 && /^sun(day)?$/.test(which)) change = { sunday: side(hours(positionals[1])) };
    else if (positionals.length === 2) change = { saturday: side(hours(positionals[0])), sunday: side(hours(positionals[1])) };
    else throw new UserError('Usage: tt weekend sat 3h [--on project] [--week DAY], tt weekend <sat-hours> <sun-hours>, or tt weekend off');
    const r = await setWeekend(day, change, SRC);
    const one = (h: number, iso: string, p: string | null) => (h ? `${h}h on ${fmtDay(iso)}${p ? ` (all on ${p})` : ''}` : `${fmtDay(iso)} off`);
    out(r.saturdayHours || r.sundayHours
      ? `Week of ${fmtDay(r.weekStart)}: planning ${one(r.saturdayHours, r.saturday, r.saturdayProject)}, ${one(r.sundayHours, r.sunday, r.sundayProject)}.`
      : `Week of ${fmtDay(r.weekStart)}: no weekend hours planned.`, r);
  },

};

async function addProjectCmd(rest: string[]) {
  const { values, positionals } = parse(rest, {
    prefix: { type: 'string' }, alias: { type: 'string', multiple: true }, color: { type: 'string' },
    share: { type: 'string' }, overhead: { type: 'boolean' },
  });
  if (!positionals.length || !values.prefix) {
    throw new UserError('Usage: tt projects add <name> --prefix WEB [--alias site --alias web] [--share 30] [--color #2ea3ae] [--overhead]');
  }
  const share = values.share === undefined ? undefined : Number(values.share.replace(/%$/, ''));
  if (share !== undefined && !Number.isFinite(share)) throw new UserError(`"${values.share}" isn't a percentage.`);
  if (values.overhead && share) throw new UserError('Overhead projects are never planned, so they take no share.');
  const p = await addProject({
    name: positionals.join(' '), prefix: values.prefix, color: values.color, weeklyPct: share, isOverhead: values.overhead,
    aliases: values.alias?.flatMap((a) => a.split(',')),
  }, SRC);
  const plan = p.isOverhead ? 'overhead, never planned' : p.weeklyPct ? `${p.weeklyPct}% of the usual week` : 'no share of the week yet';
  out(`Added ${p.prefix} ${p.name} (${plan}${p.aliases.length ? `, aka ${p.aliases.join(', ')}` : ''}). Tickets start at ${p.prefix}-001.`, p);
}

const ALIASES: Record<string, string> = {
  spent: 'log', edit: 'update', ls: 'list', rm: 'delete', new: 'add', '-h': 'help', '--help': 'help', project: 'projects',
};

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The split for the week holding `day`: percent, hours a week and hours a work day per project. */
async function showShares(day: string, note = '') {
  const [list, s, plan] = await Promise.all([listProjects(), getSettings(), getWeekPlan(day)]);
  const shares = effectiveShares(list, plan);
  const usual = defaultShares(list);
  const firstWorkDay = addDays(plan.weekStart, (Math.min(...s.workDays.map((d) => (d + 6) % 7))));
  const perDay = dayHours(firstWorkDay, s, plan);
  const focus = perDay * s.workDays.length;
  const rows = [...shares].map(([id, pct]) => {
    const p = list.find((x) => x.id === id)!;
    const was = usual.get(id) ?? 0;
    const changed = plan.shares && Math.abs(pct - was) >= 0.05 ? `  (usually ${was.toFixed(1)}%)` : '';
    return `${p.prefix.padEnd(5)} ${p.name.padEnd(26)} ${`${pct.toFixed(1)}%`.padStart(6)}  ${`${((pct / 100) * focus).toFixed(1)}h/wk`.padStart(8)}  ${`${((pct / 100) * perDay).toFixed(1)}h/day`.padStart(9)}${changed}`;
  });
  const head = `Week of ${fmtDay(plan.weekStart)}: ${plan.shares ? 'its own split (this week only)' : 'the usual split'}. ` +
    `${+focus.toFixed(2)}h of project work, ${fmtWorkDays(s.workDays)}${s.meetingHours ? `, after ${s.meetingHours}h of meetings` : ''}.`;
  const overhead = list.filter((p) => p.isOverhead).map((p) => p.name);
  out([note ? `${note}\n` : '', head, '', ...rows, overhead.length ? `\n${overhead.join(', ')}: overhead, not planned.` : '']
    .filter((l, i) => l || i === 2).join('\n'), {
    weekStart: plan.weekStart, override: plan.shares != null, focusHours: focus, hoursPerDay: perDay,
    shares: [...shares].map(([projectId, pct]) => ({ projectId, pct, usualPct: usual.get(projectId) ?? 0 })),
  });
}

async function main() {
  const [name = 'help', ...rest] = args;
  const cmd = commands[ALIASES[name] ?? name];
  if (!cmd) throw new UserError(`Unknown command "${name}". Run tt help.`);
  await applyTimezone().catch(() => undefined);
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
      ? `Can't reach Postgres. Start it (Docker: docker compose up -d), then check with: npm run setup   (in ${ROOT})`
      : `Unexpected error: ${err.message}`);
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 2 });
}
