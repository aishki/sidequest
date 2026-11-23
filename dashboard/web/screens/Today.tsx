import { api, useAction, useApi } from '../lib/api.ts';
import { dur, fmtLongDay, hrs, plural } from '../lib/format.ts';
import { openTicket } from '../lib/router.ts';
import type { Summary, TodayData } from '../lib/types.ts';
import { Dot, Loading, PriorityTag, TicketRow, TypeTag, whenOf } from '../components/bits.tsx';
import { I } from '../components/icons.tsx';

export function Today({ summary, onFind }: { summary?: Summary; onFind: () => void }) {
  const { data, error } = useApi<TodayData>('/api/today');
  if (!data) return <div className="page"><Loading error={error} /></div>;
  const open = data.list.length + (data.focus ? 1 : 0);

  return (
    <div className="page">
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">{fmtLongDay(data.today)}{data.isWorkDay ? '' : ' · day off'} · {plural(open, 'ticket')} on today{data.done.length ? ` · ${data.done.length} done` : ''}</span>
        <h1 className="display">One thing first.</h1>
      </header>

      {data.focus ? <Focus data={data} summary={summary} /> : (
        <div className="focus-empty">
          <h2 className="heading">Nothing is planned for today.</h2>
          <p className="muted" style={{ margin: 0 }}>Pick something from the Board or the Week plan, or add a new ticket.</p>
          <div><button type="button" className="btn primary" onClick={onFind}>{I.plus}Add or find a ticket</button></div>
        </div>
      )}

      {data.plan.length > 0 && (
        <section className="section" aria-labelledby="plan-h">
          <div className="section-head"><h2 className="heading" id="plan-h">Today's plan</h2>
            <span className="small muted mono">{hrs(data.plan.reduce((n, p) => n + p.loggedMin, 0))} / {hrs(data.plan.reduce((n, p) => n + p.targetMin, 0))}</span></div>
          <div className="stack" style={{ gap: 12 }}>
            {data.plan.map((p) => {
              const pct = p.targetMin ? Math.round((p.loggedMin / p.targetMin) * 100) : 0;
              const over = p.targetMin > 0 && p.loggedMin > p.targetMin;
              return (
                <div key={p.id} className="plan-row">
                  <span className="name"><Dot color={p.color} /><span>{p.name}</span></span>
                  <div className={`track${over ? ' over' : ''}`} role="progressbar" aria-label={`${p.name} time today`}
                    aria-valuemin={0} aria-valuemax={p.targetMin} aria-valuenow={p.loggedMin} aria-valuetext={`${hrs(p.loggedMin)} of ${hrs(p.targetMin)}`}>
                    <span style={{ width: `${Math.min(100, p.targetMin ? (p.loggedMin / p.targetMin) * 100 : 100)}%`, background: p.color }} />
                  </div>
                  <span className="nums">{hrs(p.loggedMin)} / {hrs(p.targetMin)}{" "}<span style={{ display: "inline-block", minWidth: 36 }} className={over ? 'warn' : 'muted'}>{p.targetMin ? `${pct}%` : ''}</span></span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="next-h">
        <div className="section-head"><h2 className="heading" id="next-h">Up next</h2>
          {data.list.length > 0 && <span className="small muted">{plural(data.list.length, 'ticket')}</span>}</div>
        {data.list.length ? (
          <div className="stack">{data.list.map((t) => <TicketRow key={t.id} t={t} today={data.today} />)}</div>
        ) : <p className="hint">Nothing else on today. That's the whole list.</p>}
      </section>

      {data.done.length > 0 && (
        <section className="section" aria-labelledby="done-h">
          <h2 className="heading" id="done-h">Done today</h2>
          <div className="stack">{data.done.map((t) => <TicketRow key={t.id} t={t} today={data.today} />)}</div>
        </section>
      )}

      <p className="hint">Tip: anything you do with <code>/t</code> in Claude Code shows up here within a second.</p>
    </div>
  );
}

function Focus({ data, summary }: { data: TodayData; summary?: Summary }) {
  const { ticket: t, subtasks, loggedMin } = data.focus!;
  const { run, busy } = useAction();
  const done = subtasks.filter((s) => s.done).length;
  const next = subtasks.findIndex((s) => !s.done);
  const timing = summary?.timer?.ticket?.key === t.key;
  const when = whenOf(t, data.today);
  const pct = subtasks.length ? (done / subtasks.length) * 100 : t.estimateMin ? Math.min(100, (loggedMin / t.estimateMin) * 100) : 0;

  return (
    <section className="focus" aria-label="Focus">
      <div className="row-flex">
        <span className="label-caps on">{timing ? 'Now · timer running' : 'Now'}</span>
        <span className="mono small muted">{t.key}</span>
        <TypeTag type={t.type} />
        <PriorityTag priority={t.priority} />
        <span className="row-flex small muted" style={{ gap: 6 }}><Dot color={t.color} />{t.projectName}</span>
        <span className="spacer" />
        {when && <span className={`small ${when.late ? 'late' : 'muted'}`}>{when.text}</span>}
      </div>
      <button type="button" className="title" onClick={() => openTicket(t.key)}
        style={{ all: 'unset', cursor: 'pointer', fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>{t.title}</button>

      <div className="stack" style={{ gap: 6 }}>
        <div className="track" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="small muted">
          {subtasks.length ? <><span className="mono-ink">{done}/{subtasks.length}</span> steps</> : 'No steps yet'}
          {' · '}<span className="mono-ink">{dur(loggedMin)}</span> logged{t.estimateMin ? <> of <span className="mono-ink">{dur(t.estimateMin)}</span></> : ''}
        </span>
      </div>

      {subtasks.length > 0 && (
        <ul className="checklist">
          {subtasks.map((s, i) => (
            <li key={s.id} className={`check${s.done ? ' is-done' : ''}`}>
              <input type="checkbox" id={`f-${s.id}`} checked={s.done} disabled={busy}
                onChange={() => run(() => api.post(`/api/tickets/${t.key}/subtasks/${i + 1}`, { action: s.done ? 'undo' : 'done' }))} />
              <label htmlFor={`f-${s.id}`} style={{ flex: 1, cursor: 'pointer' }}><span>{s.title}</span></label>
            </li>
          ))}
        </ul>
      )}

      <div className="row-flex">
        {next >= 0 ? (
          <button type="button" className="btn primary lg" disabled={busy}
            onClick={() => run(() => api.post(`/api/tickets/${t.key}/subtasks/${next + 1}`, { action: 'done' }), `Checked off: ${subtasks[next].title}`)}>
            {I.check}Mark step done
          </button>
        ) : (
          <button type="button" className="btn primary lg" disabled={busy}
            onClick={() => run(() => api.patch(`/api/tickets/${t.key}`, { status: 'done' }), `${t.key} done. Nice.`)}>
            {I.check}Mark ticket done
          </button>
        )}
        {timing ? (
          <button type="button" className="btn outline lg" disabled={busy} onClick={() => run(() => api.post('/api/timer/stop'), 'Timer stopped and logged.')}>{I.stop}Stop timer</button>
        ) : (
          <button type="button" className="btn outline lg" disabled={busy}
            onClick={() => run(() => api.post('/api/timer/start', { key: t.key, switch: true }), `Timer started on ${t.key}.`)}>{I.play}Start timer</button>
        )}
        {data.list.length > 0 && (
          <button type="button" className="btn quiet lg" disabled={busy} title={`Puts ${t.key} back in To do and starts ${data.list[0].key}`}
            onClick={() => run(async () => {
              if (t.status === 'in_progress') await api.patch(`/api/tickets/${t.key}`, { status: 'todo' });
              await api.patch(`/api/tickets/${data.list[0].key}`, { status: 'in_progress' });
              if (timing) await api.post('/api/timer/start', { key: data.list[0].key, switch: true });
            }, `Switched to ${data.list[0].key}.`)}>
            Switch task
          </button>
        )}
      </div>
    </section>
  );
}
