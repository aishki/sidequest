import { useState } from 'react';
import { toast, useApi } from '../lib/api.ts';
import { addDays, fmtDay, hrs, isoDate, parseIso, TYPE_LABEL, weekdayOf, weekNo } from '../lib/format.ts';
import { setParams } from '../lib/router.ts';
import type { ReportData } from '../lib/types.ts';
import { Dot, Loading, TicketRow } from '../components/bits.tsx';
import { I } from '../components/icons.tsx';

const WEEKEND = 'var(--cat-research)';

export function Reports({ params }: { params: URLSearchParams }) {
  const period = params.get('period') === 'month' ? 'month' : 'week';
  const day = params.get('day');
  const q = new URLSearchParams({ period });
  if (day) q.set('day', day);
  const { data, error } = useApi<ReportData>(`/api/reports?${q}`);
  const [hover, setHover] = useState<number | null>(null);
  if (!data) return <div className="page wide"><Loading error={error} /></div>;

  const lastDay = addDays(data.to, -1);
  const label = period === 'week'
    ? `W${weekNo(data.from)} · ${fmtDay(data.from)} to ${fmtDay(lastDay)}`
    : parseIso(data.from).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const step = (n: number) => {
    if (period === 'week') return setParams({ day: addDays(data.from, n * 7) });
    const d = parseIso(data.from); d.setMonth(d.getMonth() + n); setParams({ day: isoDate(d) });
  };
  const isCurrent = data.today >= data.from && data.today < data.to;
  const total = data.days.reduce((n, d) => n + d.minutes, 0);
  const target = data.projects.reduce((n, p) => n + p.targetMin, 0);
  const weekend = data.projects.reduce((n, p) => n + p.weekendMin, 0);
  const max = Math.max(60, ...data.days.map((d) => d.minutes));
  const rows = data.projects.filter((p) => p.targetMin || p.weekdayMin || p.weekendMin || p.shipped);
  const rowMax = Math.max(1, ...rows.map((p) => Math.max(p.targetMin, p.weekdayMin + p.weekendMin)));

  function copy() {
    const lines = [
      `sidequest report: ${label}`,
      `Logged ${hrs(total)} of ${hrs(target)} planned${weekend ? ` (${hrs(weekend)} on weekends)` : ''}. Shipped ${data!.shipped.length}, created ${data!.created}.`,
      '',
      'Hours by project:',
      ...rows.map((p) => `- ${p.name}: ${hrs(p.weekdayMin + p.weekendMin)} of ${hrs(p.targetMin)}${p.weekendMin ? ` (${hrs(p.weekendMin)} weekend)` : ''}${p.shipped ? `, ${p.shipped} shipped` : ''}`),
      '',
      'Shipped:',
      ...(data!.shipped.length ? data!.shipped.map((t) => `- ${t.key} ${t.title} (${TYPE_LABEL[t.type]})`) : ['- nothing yet']),
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Report copied as text.'), () => toast('Couldn\'t copy to the clipboard.', 'error'));
  }

  return (
    <div className="page wide" style={{ maxWidth: 1080 }}>
      <header className="page-head">
        <div><span className="eyebrow">{label}</span><h1 className="title">Reports</h1></div>
        <div className="row-flex">
          <div className="filters" role="group" aria-label="Period">
            <button type="button" className="chip" aria-pressed={period === 'week'} onClick={() => setParams({ period: null, day: null })}>Week</button>
            <button type="button" className="chip" aria-pressed={period === 'month'} onClick={() => setParams({ period: 'month', day: null })}>Month</button>
          </div>
          <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label={`Previous ${period}`}>{I.chevL}</button>
          {!isCurrent && <button type="button" className="btn sm" onClick={() => setParams({ day: null })}>This {period}</button>}
          <button type="button" className="icon-btn" onClick={() => step(1)} aria-label={`Next ${period}`}>{I.chevR}</button>
          <button type="button" className="btn sm" onClick={copy}>{I.copy}Copy as text</button>
        </div>
      </header>

      <div className="stats">
        <Stat label="Logged" value={hrs(total)} sub={`of ${hrs(target)} planned`} />
        <Stat label="Shipped" value={String(data.shipped.length)} sub="tickets done" />
        <Stat label="Created" value={String(data.created)} sub="new tickets" />
        <Stat label="Weekend" value={hrs(weekend)} sub={total ? `${Math.round((weekend / total) * 100)}% of logged time` : 'no time logged'} />
      </div>

      <section className="section" aria-labelledby="daily-h">
        <div className="section-head"><h2 className="heading" id="daily-h">Hours per day</h2>
          <span className="small muted">{hover != null ? <><span className="mono-ink">{hrs(data.days[hover].minutes)}</span> on {fmtDay(data.days[hover].day)}</> : 'Hover a bar for the day'}</span></div>
        <div className="card" style={{ padding: 16 }}>
          <div className="daybars" onMouseLeave={() => setHover(null)}>
            {data.days.map((d, i) => {
              const wd = weekdayOf(d.day);
              return (
                <div key={d.day} className={`b${wd === 0 || wd === 6 ? ' weekend' : ''}`} onMouseEnter={() => setHover(i)}
                  title={`${fmtDay(d.day)}: ${hrs(d.minutes)}`} aria-label={`${fmtDay(d.day)}: ${hrs(d.minutes)}`} role="img">
                  <span style={{ height: `${(d.minutes / max) * 100}%`, background: wd === 0 || wd === 6 ? WEEKEND : undefined }} />
                </div>
              );
            })}
            {total === 0 && <p className="empty">No time logged in this range yet.</p>}
          </div>
          <div className="row-flex small muted" style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <span>{fmtDay(data.from)}</span><span>{fmtDay(lastDay)}</span>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="proj-h">
        <div className="section-head"><h2 className="heading" id="proj-h">Hours by project</h2>
          <span className="row-flex small muted" style={{ gap: 12 }}>
            <span className="row-flex" style={{ gap: 6 }}><span className="dot" style={{ background: 'linear-gradient(90deg, #8f6fd1, #ff70bf)', borderRadius: 2 }} />Weekdays (project color)</span>
            <span className="row-flex" style={{ gap: 6 }}><span className="dot" style={{ background: WEEKEND, borderRadius: 2 }} />Weekend</span>
            <span className="row-flex" style={{ gap: 6 }}><span style={{ width: 2, height: 12, background: 'var(--ink)' }} />Target</span>
          </span></div>
        {rows.length === 0 ? <div className="empty">No time logged in this {period}.</div> : (
          <div className="table-wrap">
            <table className="tickets">
              <thead><tr>
                <th scope="col">Project</th><th scope="col" style={{ width: '40%' }}>Logged vs target</th>
                <th scope="col" className="num">Logged</th><th scope="col" className="num">Target</th><th scope="col" className="num">Shipped</th>
              </tr></thead>
              <tbody>
                {rows.map((p) => {
                  const logged = p.weekdayMin + p.weekendMin;
                  return (
                    <tr key={p.id} style={{ cursor: 'default' }}>
                      <td><span className="row-flex" style={{ flexWrap: 'nowrap' }}><Dot color={p.color} />{p.name}</span></td>
                      <td>
                        <div style={{ position: 'relative' }}>
                          <div className="track stacked" role="img" aria-label={`${hrs(logged)} logged, ${hrs(p.targetMin)} target`}>
                            {p.weekdayMin > 0 && <span style={{ width: `${(p.weekdayMin / rowMax) * 100}%`, background: p.color }} />}
                            {p.weekendMin > 0 && <span style={{ width: `${(p.weekendMin / rowMax) * 100}%`, background: WEEKEND }} />}
                          </div>
                          {p.targetMin > 0 && <span aria-hidden="true" style={{ position: 'absolute', top: -3, bottom: -3, width: 2, borderRadius: 1, background: 'var(--ink)', left: `calc(${(p.targetMin / rowMax) * 100}% - 1px)` }} />}
                        </div>
                      </td>
                      <td className="num"><span className={p.targetMin && logged > p.targetMin ? 'warn' : undefined}>{hrs(logged)}</span>
                        {p.weekendMin > 0 && <span className="muted"> ({hrs(p.weekendMin)} wknd)</span>}</td>
                      <td className="num muted">{p.targetMin ? hrs(p.targetMin) : '—'}</td>
                      <td className="num">{p.shipped || <span className="muted">0</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="shipped-h">
        <h2 className="heading" id="shipped-h">Shipped</h2>
        {data.shipped.length ? <div className="stack">{data.shipped.map((t) => <TicketRow key={t.id} t={t} today={data.today} />)}</div>
          : <div className="empty">Nothing marked done in this {period} yet.</div>}
      </section>
      <p className="hint">A written summary and PDF export come in phase 5.</p>
    </div>
  );
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <div className="stat"><span className="small muted">{label}</span><span className="metric">{value}</span><span className="small muted">{sub}</span></div>
);
