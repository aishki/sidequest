import { useRef } from 'react';
import { api, useAction, useApi } from '../lib/api.ts';
import { DropZone, useDraggableTicket, useDraggedTicket, useDragAutoScroll } from '../lib/dnd.tsx';
import { addDays, fmtDay, hrs, parseIso, weekdayOf, weekNo } from '../lib/format.ts';
import { openTicket, setParams } from '../lib/router.ts';
import type { Ticket, WeekData } from '../lib/types.ts';
import { Dot, Loading } from '../components/bits.tsx';
import { I } from '../components/icons.tsx';
import { Plan } from './WeekPlan.tsx';

export function Week({ params }: { params: URLSearchParams }) {
  const day = params.get('day');
  const { data, error } = useApi<WeekData>(`/api/week${day ? `?day=${day}` : ''}`);
  const { run } = useAction();
  const dragKey = useDraggedTicket();
  const gridRef = useRef<HTMLDivElement>(null);
  useDragAutoScroll(gridRef);
  if (!data) return <div className="page wide"><Loading error={error} /></div>;

  const go = (n: number) => setParams({ day: addDays(data.weekStart, n * 7) });
  const isThisWeek = data.days.includes(data.today);
  const all = [...data.planned, ...data.unplanned];

  function drop(key: string, plannedOn: string | null) {
    const t = all.find((x) => x.key === key);
    if (t && t.plannedOn !== plannedOn) {
      run(() => api.patch(`/api/tickets/${key}`, { plannedOn }), plannedOn ? `${key} planned for ${fmtDay(plannedOn)}.` : `${key} unplanned.`);
    }
  }
  const card = (t: Ticket) => <MiniCard key={t.id} t={t} />;

  const weekTarget = data.cells.flat().reduce((n, c) => n + c.targetMin, 0);
  const weekLogged = data.cells.flat().reduce((n, c) => n + c.loggedMin, 0);

  return (
    <div className="page wide">
      <header className="page-head">
        <div>
          <span className="eyebrow">W{weekNo(data.weekStart)} · {fmtDay(data.weekStart)} to {fmtDay(addDays(data.weekStart, 6))}</span>
          <h1 className="title">Week plan</h1>
        </div>
        <div className="row-flex">
          <span className="small muted"><span className="mono-ink">{hrs(weekLogged)}</span> of <span className="mono-ink">{hrs(weekTarget)}</span> logged</span>
          <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label="Previous week">{I.chevL}</button>
          {!isThisWeek && <button type="button" className="btn sm" onClick={() => setParams({ day: null })}>This week</button>}
          <button type="button" className="icon-btn" onClick={() => go(1)} aria-label="Next week">{I.chevR}</button>
        </div>
      </header>

      <Plan data={data} tab={params.get('plan')} />

      <div className="week-grid" ref={gridRef}>
        {data.days.map((d, i) => {
          const wd = weekdayOf(d);
          const target = data.cells[i].reduce((n, c) => n + c.targetMin, 0);
          const logged = data.cells[i].reduce((n, c) => n + c.loggedMin, 0);
          const off = target === 0;
          const tickets = data.planned.filter((t) => t.plannedOn === d);
          const estMin = tickets.reduce((n, t) => n + (t.estimateMin ?? 0), 0);
          const capMin = data.hours[i] * 60;
          const overCap = estMin > capMin + 0.5;
          return (
            // The whole day column takes the drop, so a day with few tickets is easy to hit.
            <DropZone key={d} as="section" className="day" label={fmtDay(d)} onDropKey={(key) => drop(key, d)}>
              <div className={`day-head${d === data.today ? ' is-today' : ''}${off ? ' off' : ''}`}>
                <span className="row-flex" style={{ justifyContent: 'space-between' }}>
                  <b>{parseIso(d).toLocaleDateString('en-GB', { weekday: 'short' })} <span className="muted" style={{ fontWeight: 400 }}>{parseIso(d).getDate()}</span></b>
                  {d === data.today && <span className="small" style={{ color: 'var(--accent)' }}>Today</span>}
                </span>
                <span className="small mono muted">{off ? (wd === 0 || wd === 6 ? 'Off' : 'No target') : `${hrs(logged)} / ${hrs(target)}`}</span>
                {estMin > 0 && (
                  <span className={`small mono${overCap ? ' warn' : ' muted'}`}
                    title={overCap ? `Planned tickets are estimated at ${hrs(estMin)}, more than the ${hrs(capMin)} you have this day.` : `Planned tickets are estimated at ${hrs(estMin)} of the ${hrs(capMin)} you have this day.`}>
                    {overCap && <span aria-hidden="true">▲ </span>}est {hrs(estMin)}{overCap ? ' · over' : ''}
                  </span>
                )}
              </div>
              <div className="well">
                {tickets.map(card)}
                {tickets.length === 0 && <div className="empty-col">{dragKey ? 'Drop to plan' : '—'}</div>}
              </div>
            </DropZone>
          );
        })}
      </div>

      <section className="section" aria-labelledby="unplanned-h">
        <div className="section-head"><h2 className="heading" id="unplanned-h">Not planned yet</h2>
          <span className="small muted">{data.unplanned.length} open · drag onto a day</span></div>
        <DropZone className="well" style={{ flexDirection: 'row', flexWrap: 'wrap', minHeight: 72 }} onDropKey={(key) => drop(key, null)}>
          {data.unplanned.map((t) => <div key={t.id} style={{ width: 220 }}>{card(t)}</div>)}
          {data.unplanned.length === 0 && <div className="empty-col" style={{ width: '100%' }}>{dragKey ? 'Drop here to unplan' : 'Every open ticket has a day.'}</div>}
        </DropZone>
      </section>

      <HoursGrid data={data} />
    </div>
  );
}

function MiniCard({ t }: { t: Ticket }) {
  const ref = useRef<HTMLButtonElement>(null);
  const dragging = useDraggableTicket(ref, t.key);
  return (
    <button ref={ref} type="button" className={`mini${t.status === 'done' ? ' done' : ''}${dragging ? ' dragging' : ''}`} onClick={() => openTicket(t.key)}>
      <span className="key"><Dot color={t.color} label={t.projectName} />{t.key}{t.status === 'done' && <span className="ok">{I.check}</span>}</span>
      <span>{t.title}</span>
    </button>
  );
}

function HoursGrid({ data }: { data: WeekData }) {
  const rows = data.projects
    .map((p, j) => ({ p, cells: data.cells.map((day) => day[j]) }))
    .filter((r) => r.cells.some((c) => c.targetMin || c.loggedMin));
  if (!rows.length) return null;
  const cell = (c: { targetMin: number; loggedMin: number }) =>
    !c.targetMin && !c.loggedMin ? <span className="muted">·</span>
      : <span className={c.targetMin && c.loggedMin > c.targetMin ? 'warn' : undefined}>{hrs(c.loggedMin)}<span className="muted"> / {hrs(c.targetMin)}</span></span>;
  return (
    <section className="section" aria-labelledby="hours-h">
      <h2 className="heading" id="hours-h">Hours by project</h2>
      <div className="table-wrap">
        <table className="tickets">
          <thead><tr>
            <th scope="col">Project</th>
            {data.days.map((d) => <th key={d} scope="col" className="num">{parseIso(d).toLocaleDateString('en-GB', { weekday: 'short' })}</th>)}
            <th scope="col" className="num">Week</th>
          </tr></thead>
          <tbody>
            {rows.map(({ p, cells }) => (
              <tr key={p.id} style={{ cursor: 'default' }}>
                <th scope="row" style={{ background: 'transparent', borderBottom: '1px solid var(--line)', fontSize: 14, color: 'var(--ink)' }}>
                  <span className="row-flex" style={{ flexWrap: 'nowrap' }}><Dot color={p.color} />{p.name}</span></th>
                {cells.map((c, i) => <td key={i} className="num">{cell(c)}</td>)}
                <td className="num" style={{ fontWeight: 600 }}>{cell({ targetMin: cells.reduce((n, c) => n + c.targetMin, 0), loggedMin: cells.reduce((n, c) => n + c.loggedMin, 0) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Targets come from each project's share of the week{data.weekOverride ? ' (this week has its own split)' : ''}. Amber means over target.</p>
    </section>
  );
}
