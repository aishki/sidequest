import { useState, type DragEvent, type FormEvent } from 'react';
import { api, useAction, useApi } from '../lib/api.ts';
import { addDays, fmtDay, hrs, parseIso, weekdayOf, weekNo } from '../lib/format.ts';
import { openTicket, setParams } from '../lib/router.ts';
import type { Ticket, WeekData } from '../lib/types.ts';
import { Dot, Loading } from '../components/bits.tsx';
import { I } from '../components/icons.tsx';

export function Week({ params }: { params: URLSearchParams }) {
  const day = params.get('day');
  const { data, error } = useApi<WeekData>(`/api/week${day ? `?day=${day}` : ''}`);
  const { run } = useAction();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!data) return <div className="page wide"><Loading error={error} /></div>;

  const go = (n: number) => setParams({ day: addDays(data.weekStart, n * 7) });
  const isThisWeek = data.days.includes(data.today);
  const all = [...data.planned, ...data.unplanned];

  function drop(e: DragEvent, plannedOn: string | null) {
    e.preventDefault();
    setOver(null);
    const key = e.dataTransfer.getData('text/plain');
    const t = all.find((x) => x.key === key);
    if (t && t.plannedOn !== plannedOn) {
      run(() => api.patch(`/api/tickets/${key}`, { plannedOn }), plannedOn ? `${key} planned for ${fmtDay(plannedOn)}.` : `${key} unplanned.`);
    }
  }
  const zone = (id: string, plannedOn: string | null) => ({
    className: `well${over === id ? ' over' : ''}`,
    onDragOver: (e: DragEvent) => { if (dragKey) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(id); } },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); },
    onDrop: (e: DragEvent) => drop(e, plannedOn),
  });
  const card = (t: Ticket) => (
    <button key={t.id} type="button" className={`mini${t.status === 'done' ? ' done' : ''}`} draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.key); e.dataTransfer.effectAllowed = 'move'; setDragKey(t.key); }}
      onDragEnd={() => { setDragKey(null); setOver(null); }} onClick={() => openTicket(t.key)}>
      <span className="key"><Dot color={t.color} label={t.projectName} />{t.key}{t.status === 'done' && <span className="ok">{I.check}</span>}</span>
      <span>{t.title}</span>
    </button>
  );

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

      <Weekend data={data} />

      <div className="week-grid">
        {data.days.map((d, i) => {
          const wd = weekdayOf(d);
          const target = data.cells[i].reduce((n, c) => n + c.targetMin, 0);
          const logged = data.cells[i].reduce((n, c) => n + c.loggedMin, 0);
          const off = target === 0;
          const tickets = data.planned.filter((t) => t.plannedOn === d);
          return (
            <section key={d} className="day" aria-label={fmtDay(d)}>
              <div className={`day-head${d === data.today ? ' is-today' : ''}${off ? ' off' : ''}`}>
                <span className="row-flex" style={{ justifyContent: 'space-between' }}>
                  <b>{parseIso(d).toLocaleDateString('en-GB', { weekday: 'short' })} <span className="muted" style={{ fontWeight: 400 }}>{parseIso(d).getDate()}</span></b>
                  {d === data.today && <span className="small" style={{ color: 'var(--accent)' }}>Today</span>}
                </span>
                <span className="small mono muted">{off ? (wd === 0 || wd === 6 ? 'Off' : 'No target') : `${hrs(logged)} / ${hrs(target)}`}</span>
              </div>
              <div {...zone(d, d)}>
                {tickets.map(card)}
                {tickets.length === 0 && <div className="empty-col">{dragKey ? 'Drop to plan' : '—'}</div>}
              </div>
            </section>
          );
        })}
      </div>

      <section className="section" aria-labelledby="unplanned-h">
        <div className="section-head"><h2 className="heading" id="unplanned-h">Not planned yet</h2>
          <span className="small muted">{data.unplanned.length} open · drag onto a day</span></div>
        <div {...zone('none', null)} style={{ flexDirection: 'row', flexWrap: 'wrap', minHeight: 72 }}>
          {data.unplanned.map((t) => <div key={t.id} style={{ width: 220 }}>{card(t)}</div>)}
          {data.unplanned.length === 0 && <div className="empty-col" style={{ width: '100%' }}>{dragKey ? 'Drop here to unplan' : 'Every open ticket has a day.'}</div>}
        </div>
      </section>

      <HoursGrid data={data} />
    </div>
  );
}

function Weekend({ data }: { data: WeekData }) {
  const { run, busy } = useAction();
  const [sat, setSat] = useState(String(data.saturdayHours));
  const [sun, setSun] = useState(String(data.sundayHours));
  const [editing, setEditing] = useState(false);
  const on = data.saturdayHours > 0 || data.sundayHours > 0;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.post('/api/week/weekend', { day: data.weekStart, saturdayHours: Number(sat) || 0, sundayHours: Number(sun) || 0 }), 'Weekend hours saved.')) setEditing(false);
  }
  if (!editing) {
    return (
      <div className="row-flex small">
        <span className="muted">{on
          ? <>Weekend work this week: Sat <span className="mono-ink">{data.saturdayHours}h</span>, Sun <span className="mono-ink">{data.sundayHours}h</span>.</>
          : <>Weekends are off. Weekday target: <span className="mono-ink">{data.weekHours}h</span> over {data.workDays.length} days.</>}</span>
        <button type="button" className="btn quiet sm" onClick={() => { setSat(String(data.saturdayHours)); setSun(String(data.sundayHours)); setEditing(true); }}>
          {on ? 'Change weekend' : 'Work this weekend'}
        </button>
      </div>
    );
  }
  return (
    <form className="row-flex" onSubmit={save} aria-label="Weekend hours">
      <label className="field" style={{ width: 120 }}><span>Saturday hours</span>
        <input className="input mono" type="number" min={0} max={16} step={0.5} value={sat} onChange={(e) => setSat(e.target.value)} /></label>
      <label className="field" style={{ width: 120 }}><span>Sunday hours</span>
        <input className="input mono" type="number" min={0} max={16} step={0.5} value={sun} onChange={(e) => setSun(e.target.value)} /></label>
      <div className="row-flex" style={{ alignSelf: 'flex-end' }}>
        <button type="submit" className="btn primary" disabled={busy}>Save</button>
        <button type="button" className="btn quiet" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      <p className="hint" style={{ width: '100%' }}>Weekend hours are extra and only count for this week. Set both to 0 to turn the weekend off.</p>
    </form>
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
      <p className="hint">Targets come from each project's share of your {data.weekHours}h week. Amber means over target.</p>
    </section>
  );
}
