import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, useAction, useApi } from '../lib/api.ts';
import { dur, fmtStamp, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../lib/format.ts';
import { closeTicket, openTicket } from '../lib/router.ts';
import { PRIORITIES, STATUSES, TYPES, type EventRow, type Summary, type Ticket, type TicketDetail } from '../lib/types.ts';
import { Dot, Loading, StatusTag } from './bits.tsx';
import { I } from './icons.tsx';

export function TicketDrawer({ ticketKey, summary }: { ticketKey: string; summary?: Summary }) {
  const { data, error } = useApi<TicketDetail>(`/api/tickets/${encodeURIComponent(ticketKey)}`);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.palette')) closeTicket();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);

  return (
    <>
      <div className="backdrop" onClick={closeTicket} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Ticket ${ticketKey}`} ref={panel} tabIndex={-1}>
        {data ? <Editor d={data} summary={summary} /> : (
          <>
            <div className="drawer-head"><span className="mono muted">{ticketKey}</span><span className="spacer" />
              <button type="button" className="icon-btn" onClick={closeTicket} aria-label="Close">{I.close}</button></div>
            <div className="drawer-body"><Loading error={error} /></div>
          </>
        )}
      </aside>
    </>
  );
}

function Editor({ d, summary }: { d: TicketDetail; summary?: Summary }) {
  const t = d.ticket;
  const { run, busy } = useAction();
  const patch = (body: Partial<Record<keyof Ticket, unknown>>, msg?: string) =>
    run(() => api.patch<Ticket>(`/api/tickets/${t.key}`, body), msg);
  const timerHere = summary?.timer?.ticket?.key === t.key;
  const otherTimer = summary?.timer && !timerHere ? summary.timer : null;
  const today = summary?.today ?? '';
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fresh = t.updatedAt; // remount uncontrolled inputs when the ticket changes elsewhere

  async function move(projectId: string) {
    const r = await run(() => api.post<{ ticket: Ticket; from: string }>(`/api/tickets/${t.key}/move`, { projectId: Number(projectId) }));
    if (r) openTicket(r.ticket.key);
  }

  return (
    <>
      <div className="drawer-head">
        <Dot color={t.color} label={t.projectName} />
        <span className="mono" style={{ fontSize: 12 }}>{t.key}</span>
        <span className="small muted">{t.projectName}</span>
        <span className="spacer" />
        {confirmDelete ? (
          <>
            <span className="small">Delete {t.key}?</span>
            <button type="button" className="btn danger sm" disabled={busy}
              onClick={async () => { if (await run(() => api.del(`/api/tickets/${t.key}`), `Deleted ${t.key}.`)) closeTicket(); }}>Delete</button>
            <button type="button" className="btn quiet sm" onClick={() => setConfirmDelete(false)}>Keep</button>
          </>
        ) : (
          <button type="button" className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${t.key}`} title="Delete">{I.trash}</button>
        )}
        <button type="button" className="icon-btn" onClick={closeTicket} aria-label="Close">{I.close}</button>
      </div>

      <div className="drawer-body">
        <div className="stack">
          <label className="sr-only" htmlFor="t-title">Title</label>
          <input id="t-title" key={`title-${fresh}`} className="input title-input" defaultValue={t.title} maxLength={200}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== t.title) patch({ title: v }); else e.currentTarget.value = t.title; }} />
          <div className="row-flex">
            <StatusTag status={t.status} />
            <span className="small muted">Logged <span className="mono-ink">{dur(d.loggedMin)}</span>{t.estimateMin ? <> of <span className="mono-ink">{dur(t.estimateMin)}</span></> : null}</span>
          </div>
        </div>

        <div className="row-flex">
          {t.status !== 'done' && (
            <button type="button" className="btn primary" disabled={busy} onClick={() => patch({ status: 'done' }, `${t.key} done.`)}>{I.check}Mark done</button>
          )}
          {t.status === 'done' && (
            <button type="button" className="btn" disabled={busy} onClick={() => patch({ status: 'todo' }, `${t.key} reopened.`)}>Reopen</button>
          )}
          {timerHere ? (
            <button type="button" className="btn outline" disabled={busy} onClick={() => run(() => api.post('/api/timer/stop'), 'Timer stopped and logged.')}>{I.stop}Stop timer</button>
          ) : (
            <button type="button" className="btn outline" disabled={busy}
              title={otherTimer ? `Stops the timer on ${otherTimer.ticket?.key ?? otherTimer.project.name} first` : undefined}
              onClick={() => run(() => api.post('/api/timer/start', { key: t.key, switch: true }), otherTimer ? 'Switched the timer.' : 'Timer started.')}>
              {I.play}{otherTimer ? 'Switch timer here' : 'Start timer'}
            </button>
          )}
          {t.plannedOn !== today && t.status !== 'done' && today && (
            <button type="button" className="btn quiet" disabled={busy} onClick={() => patch({ plannedOn: today }, 'Planned for today.')}>Plan for today</button>
          )}
        </div>

        <div className="grid-2">
          <label className="field"><span>Project</span>
            <select className="select" value={t.projectId} onChange={(e) => move(e.target.value)}>
              {summary?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.prefix})</option>)}
            </select>
          </label>
          <label className="field"><span>Status</span>
            <select className="select" value={t.status} onChange={(e) => patch({ status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="field"><span>Type</span>
            <select className="select" value={t.type} onChange={(e) => patch({ type: e.target.value })}>
              {TYPES.map((s) => <option key={s} value={s}>{TYPE_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="field"><span>Priority</span>
            <select className="select" value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {PRIORITIES.map((s) => <option key={s} value={s}>{PRIORITY_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="field"><span>Planned for</span>
            <input type="date" className="input" key={`p-${fresh}`} defaultValue={t.plannedOn ?? ''}
              onChange={(e) => { if (!e.target.value || /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) patch({ plannedOn: e.target.value || null }); }} />
          </label>
          <label className="field"><span>Due</span>
            <input type="date" className="input" key={`d-${fresh}`} defaultValue={t.dueOn ?? ''}
              onChange={(e) => { if (!e.target.value || /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) patch({ dueOn: e.target.value || null }); }} />
          </label>
          <label className="field"><span>Estimate</span>
            <input className="input mono" key={`e-${fresh}`} placeholder="e.g. 2h or 90m" defaultValue={t.estimateMin ? dur(t.estimateMin) : ''}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (v === (t.estimateMin ? dur(t.estimateMin) : '')) return;
                patch({ estimateMin: v || null });
              }} />
          </label>
        </div>

        <Subtasks d={d} />

        <label className="field"><span>Notes</span>
          <textarea className="textarea" key={`n-${fresh}`} defaultValue={t.notes ?? ''} placeholder="Context, links, next step…"
            onBlur={(e) => { const v = e.currentTarget.value; if (v.trim() !== (t.notes ?? '')) patch({ notes: v.trim() || null }, 'Notes saved.'); }} />
        </label>

        <LogTime ticketKey={t.key} today={today} />

        {d.recent.length > 0 && (
          <section className="section">
            <h3 className="heading">Recent time</h3>
            <ul className="history">
              {d.recent.map((e) => (
                <li key={e.id}><span className="when">{fmtStamp(e.startedAt)}</span>
                  <span className="mono">{e.endedAt ? dur((new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()) / 60000) : 'running'}</span>
                  <span className="muted">{e.source === 'timer' ? 'timer' : 'logged'}{e.note ? ` · ${e.note}` : ''}</span></li>
              ))}
            </ul>
          </section>
        )}

        <section className="section">
          <h3 className="heading">History</h3>
          <ul className="history">
            {d.history.map((e) => (
              <li key={e.id}><span className="when">{fmtStamp(e.at)}</span><span>{describe(e)} <span className="muted">· {e.source === 'cli' ? '/t' : e.source}</span></span></li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function Subtasks({ d }: { d: TicketDetail }) {
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  const key = d.ticket.key;
  async function add(e: FormEvent) {
    e.preventDefault();
    const titles = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!titles.length) return;
    if (await run(() => api.post(`/api/tickets/${key}/subtasks`, { titles }))) setText('');
  }
  const done = d.subtasks.filter((s) => s.done).length;
  return (
    <section className="section" aria-label="Subtasks">
      <div className="section-head"><h3 className="heading">Subtasks</h3>
        {d.subtasks.length > 0 && <span className="small muted mono">{done}/{d.subtasks.length}</span>}</div>
      {d.subtasks.length > 0 && (
        <ul className="checklist">
          {d.subtasks.map((s, i) => (
            <li key={s.id} className={`check${s.done ? ' is-done' : ''}`}>
              <input type="checkbox" id={`st-${s.id}`} checked={s.done} disabled={busy}
                onChange={() => run(() => api.post(`/api/tickets/${key}/subtasks/${i + 1}`, { action: s.done ? 'undo' : 'done' }))} />
              <label htmlFor={`st-${s.id}`} style={{ flex: 1, cursor: 'pointer' }}><span>{s.title}</span></label>
              <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Remove subtask ${s.title}`} disabled={busy}
                onClick={() => run(() => api.post(`/api/tickets/${key}/subtasks/${i + 1}`, { action: 'remove' }))}>{I.close}</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="row-flex">
        <label className="sr-only" htmlFor="new-sub">New subtask</label>
        <input id="new-sub" className="input" style={{ flex: 1 }} placeholder="Add a subtask" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
        <button type="submit" className="btn" disabled={busy || !text.trim()}>{I.plus}Add</button>
      </form>
    </section>
  );
}

function LogTime({ ticketKey, today }: { ticketKey: string; today: string }) {
  const { run, busy } = useAction();
  const [duration, setDuration] = useState('');
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  useEffect(() => setDay(today), [today]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.post('/api/time', { key: ticketKey, duration, day, note }), `Logged ${duration} on ${ticketKey}.`)) {
      setDuration(''); setNote('');
    }
  }
  return (
    <form className="section" onSubmit={submit} aria-label="Log time">
      <h3 className="heading">Log time</h3>
      <div className="grid-3">
        <label className="field"><span>Duration</span>
          <input className="input mono" required placeholder="1h30m" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
        <label className="field"><span>Day</span>
          <input type="date" className="input" required value={day} max={today} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="field"><span>Note (optional)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div><button type="submit" className="btn" disabled={busy || !duration.trim()}>Log time</button></div>
    </form>
  );
}

function describe(e: EventRow): string {
  const d = e.data as Record<string, unknown>;
  switch (e.kind) {
    case 'ticket.created': return 'Created';
    case 'ticket.updated': {
      const ch = (d.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const text = Object.entries(ch).map(([k, v]) => changeText(k, v.from, v.to)).join('; ') || 'Updated';
      return d.reason === 'due' ? `${text} (automatic: due soon)` : text;
    }
    case 'ticket.moved': return `Moved from ${d.from} to ${d.to}`;
    case 'subtask.added': return `Added ${(d.titles as string[])?.length === 1 ? 'subtask' : 'subtasks'}: ${(d.titles as string[])?.join(', ')}`;
    case 'subtask.done': return `Checked off: ${d.title}`;
    case 'subtask.undo': return `Unchecked: ${d.title}`;
    case 'subtask.remove': return `Removed subtask: ${d.title}`;
    case 'time.logged': return `Logged ${dur(Number(d.minutes))}`;
    case 'timer.started': return 'Timer started';
    case 'timer.stopped': return `Timer stopped after ${dur(Number(d.minutes))}`;
    case 'timer.cancelled': return 'Timer discarded';
    default: return e.kind;
  }
}

const FIELD: Record<string, string> = { title: 'Title', notes: 'Notes', type: 'Type', status: 'Status', priority: 'Priority', estimateMin: 'Estimate', dueOn: 'Due', plannedOn: 'Planned' };
function changeText(field: string, from: unknown, to: unknown) {
  const show = (v: unknown) => {
    if (v == null || v === '') return 'none';
    if (field === 'status') return STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? String(v);
    if (field === 'type') return TYPE_LABEL[v as keyof typeof TYPE_LABEL] ?? String(v);
    if (field === 'priority') return PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? String(v);
    if (field === 'estimateMin') return dur(Number(v));
    return String(v);
  };
  if (field === 'notes') return 'Notes edited';
  if (field === 'title') return `Renamed to "${to}"`;
  return `${FIELD[field] ?? field}: ${show(from)} → ${show(to)}`;
}
