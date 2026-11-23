import { useEffect, useState } from 'react';
import { api, toast, useAction, useApi } from '../lib/api.ts';
import { addDays, fmtDay, fmtStamp, hrs, plural, TYPE_LABEL, weekdayOf } from '../lib/format.ts';
import { openTicket, setParams } from '../lib/router.ts';
import type { ReportData, ReportPeriod } from '../lib/types.ts';
import { Dot, Loading, TypeTag } from '../components/bits.tsx';
import { I } from '../components/icons.tsx';

const WEEKEND = 'var(--cat-research)';
const PERIODS: ReportPeriod[] = ['week', 'month', 'quarter'];
const isWeekend = (iso: string) => [0, 6].includes(weekdayOf(iso));

/** "3h", "2.5 days", "under 1h". */
function span(days: number) {
  if (days < 1 / 24) return 'under 1h';
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)} days`;
}

/** Steps a period start by n periods; the server snaps any day to its period. */
function stepDay(period: ReportPeriod, from: string, n: number) {
  if (period === 'week') return addDays(from, n * 7);
  const [y, m] = from.split('-').map(Number);
  const d = new Date(y, m - 1 + n * (period === 'quarter' ? 3 : 1), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function Reports({ params }: { params: URLSearchParams }) {
  const raw = params.get('period');
  const period: ReportPeriod = raw === 'month' || raw === 'quarter' ? raw : 'week';
  const day = params.get('day');
  const q = new URLSearchParams({ period });
  if (day) q.set('day', day);
  const { data, error } = useApi<ReportData>(`/api/reports?${q}`);
  if (!data) return <div className="page wide"><Loading error={error} /></div>;

  const s = data.stats;
  const isCurrent = data.today >= data.from && data.today < data.to;
  const rows = data.projects.filter((p) => p.targetMin || p.weekdayMin || p.weekendMin || p.shipped);
  const weekdayMin = s.loggedMin - s.weekendMin;

  function updateText() {
    const lines = [`Update: ${data!.label}`, ''];
    if (data!.summary) lines.push(data!.summary.body, '');
    lines.push(`Shipped (${s.shipped}):`,
      ...(data!.shipped.length ? data!.shipped.map((t) => `- ${t.key} ${t.title} (${t.projectName}, ${TYPE_LABEL[t.type]})`) : ['- nothing yet']),
      '',
      `Hours: ${hrs(weekdayMin)} of ${hrs(s.targetMin)} planned${s.weekendMin ? `, plus ${hrs(s.weekendMin)} on weekends` : ''}`,
      ...rows.filter((p) => p.weekdayMin + p.weekendMin > 0)
        .map((p) => `- ${p.name}: ${hrs(p.weekdayMin + p.weekendMin)}${p.targetMin ? ` of ${hrs(p.targetMin)}` : ''}${p.weekendMin ? ` (${hrs(p.weekendMin)} weekend)` : ''}`));
    return lines.join('\n');
  }
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(() => toast(`${what} copied.`), () => toast('Couldn\'t copy to the clipboard.', 'error'));

  function savePdf() {
    const old = document.title;
    const name = period === 'week' ? data!.label.split(' · ')[0] + ' ' + data!.from.slice(0, 4) : data!.label;
    document.title = `sidequest report ${name}`;
    const restore = () => { document.title = old; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  return (
    <div className="page wide report" style={{ maxWidth: 1080 }}>
      <header className="page-head">
        <div><span className="eyebrow">{data.label}{isCurrent ? ' · so far' : ''}</span><h1 className="title">Reports</h1></div>
        <div className="row-flex no-print">
          <div className="filters" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={period === p}
                onClick={() => setParams({ period: p === 'week' ? null : p, day: null })}>{p[0].toUpperCase() + p.slice(1)}</button>
            ))}
          </div>
          <button type="button" className="icon-btn" onClick={() => setParams({ day: stepDay(period, data.from, -1) })} aria-label={`Previous ${period}`}>{I.chevL}</button>
          {!isCurrent && <button type="button" className="btn sm" onClick={() => setParams({ day: null })}>This {period}</button>}
          <button type="button" className="icon-btn" onClick={() => setParams({ day: stepDay(period, data.from, 1) })} aria-label={`Next ${period}`}>{I.chevR}</button>
          <button type="button" className="btn sm" onClick={() => copy(updateText(), 'Update')}>{I.copy}Copy as update</button>
          <button type="button" className="btn sm" onClick={savePdf}>{I.file}Save as PDF</button>
        </div>
      </header>

      <div className="stats">
        <Stat label="Shipped" value={String(s.shipped)} sub={`${plural(s.created, 'ticket')} created`} />
        <Stat label="Hours logged" value={hrs(weekdayMin)} sub={`of ${hrs(s.targetMin)} planned${s.weekendMin ? ` · +${hrs(s.weekendMin)} weekend` : ''}`} />
        <Stat label="Done on time" value={s.dueCount ? `${Math.round((s.onTimeCount / s.dueCount) * 100)}%` : '—'}
          sub={s.dueCount ? `${s.onTimeCount} of ${s.dueCount} with a due date` : 'nothing shipped had a due date'} />
        <Stat label="Start to done" value={s.avgDaysToDone == null ? '—' : span(s.avgDaysToDone)} sub={s.avgDaysToDone == null ? 'nothing shipped yet' : 'on average'} />
        <Stat label="Launch films" value={String(s.launchFilms)} sub="shipped" />
      </div>

      <SummaryCard key={`${period}:${data.from}`} data={data} onCopy={(t) => copy(t, 'Summary')} />

      <DayChart data={data} />

      <section className="section" aria-labelledby="proj-h">
        <div className="section-head"><h2 className="heading" id="proj-h">Planned vs logged</h2>
          <span className="row-flex small muted" style={{ gap: 12 }}>
            <span className="row-flex" style={{ gap: 6 }}><span className="dot" style={{ background: 'linear-gradient(90deg, #8f6fd1, #ff70bf)', borderRadius: 2 }} />Weekdays (project color)</span>
            <span className="row-flex" style={{ gap: 6 }}><span className="dot" style={{ background: WEEKEND, borderRadius: 2 }} />Weekend, extra</span>
            <span className="row-flex" style={{ gap: 6 }}><span style={{ width: 2, height: 12, background: 'var(--ink)' }} />Planned</span>
          </span></div>
        {rows.length === 0 ? <div className="empty">No time logged in this {period}.</div> : <PlanTable rows={rows} />}
      </section>

      <section className="section" aria-labelledby="shipped-h">
        <div className="section-head"><h2 className="heading" id="shipped-h">What I shipped</h2>
          {data.shipped.length > 0 && <span className="small muted">Hours are all time logged on the ticket</span>}</div>
        {data.shipped.length ? (
          <div className="table-wrap">
            <table className="tickets">
              <thead><tr>
                <th scope="col">Ticket</th><th scope="col">Project</th><th scope="col">Type</th>
                <th scope="col">Done</th><th scope="col" className="num">Hours</th>
              </tr></thead>
              <tbody>
                {data.shipped.map((t) => (
                  <tr key={t.id} onClick={() => openTicket(t.key)}>
                    <td><span className="key">{t.key}</span>{' '}
                      <button type="button" className="link-btn ttl" onClick={(e) => { e.stopPropagation(); openTicket(t.key); }}>{t.title}</button></td>
                    <td><span className="row-flex" style={{ flexWrap: 'nowrap' }}><Dot color={t.color} />{t.projectName}</span></td>
                    <td><TypeTag type={t.type} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(t.doneDay)}
                      {t.onTime === false && <span className="small warn"> · due {fmtDay(t.dueOn!)}</span>}</td>
                    <td className="num">{t.minutes ? hrs(t.minutes) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">Nothing marked done in this {period} yet.</div>}
      </section>
      <p className="hint print-only">sidequest · {data.label} · printed {fmtDay(data.today)}</p>
    </div>
  );
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <div className="stat"><span className="small muted">{label}</span><span className="metric">{value}</span><span className="small muted">{sub}</span></div>
);

function SummaryCard({ data, onCopy }: { data: ReportData; onCopy: (text: string) => void }) {
  const saved = data.summary?.body ?? '';
  const [edit, setEdit] = useState<string | null>(null);
  const { run, busy } = useAction();
  const [drafting, setDrafting] = useState(false);
  const text = edit ?? saved;
  const dirty = edit != null && edit.trim() !== saved;
  const nothing = !data.stats.loggedMin && !data.stats.shipped;

  // Once a save lands, drop the local copy so the card shows what's stored.
  useEffect(() => { if (edit != null && edit.trim() === saved) setEdit(null); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => run(() => api.put('/api/reports/summary', { period: data.period, day: data.from, body: text }), text.trim() ? 'Summary saved.' : 'Summary removed.')
    .then((r) => { if (r) setEdit(null); });
  async function draft() {
    setDrafting(true);
    const r = await run(() => api.post('/api/reports/summary/draft', { period: data.period, day: data.from }), 'Claude drafted the summary.');
    setDrafting(false);
    if (r) setEdit(null);
  }

  const who = data.summary && (data.summary.author === 'claude' ? 'Drafted by Claude' : 'Edited by you');
  return (
    <section className="section" aria-labelledby="sum-h">
      <div className="section-head"><h2 className="heading" id="sum-h">Summary for your update</h2>
        <span className="small muted no-print">{drafting ? 'Claude is writing… this takes a few seconds'
          : dirty ? 'Unsaved changes' : who ? `${who} · ${fmtStamp(data.summary!.updatedAt)}` : 'Not written yet'}</span></div>
      <div className="card summary-card">
        <textarea className="textarea no-print" aria-labelledby="sum-h" rows={Math.max(5, Math.min(14, text.split('\n').length + 1))}
          value={text} disabled={drafting}
          placeholder={nothing ? `Nothing logged or shipped in this ${data.period} yet.` : 'Draft with Claude, or write it yourself. Edits are yours to keep.'}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === 's')) { e.preventDefault(); if (dirty) save(); } }} />
        <div className="print-only summary-print">{saved || 'No summary written for this period.'}</div>
        <div className="row-flex no-print" style={{ justifyContent: 'space-between' }}>
          <span className="row-flex">
            <button type="button" className="btn sm" onClick={draft} disabled={drafting || busy || dirty || nothing}
              title={dirty ? 'Save or discard your edits first' : nothing ? 'Nothing to summarize yet' : 'Runs Claude Code on this computer'}>
              {I.sparkle}{drafting ? 'Writing…' : saved ? 'Redraft with Claude' : 'Draft with Claude'}</button>
            {saved && !dirty && <button type="button" className="btn sm quiet" onClick={() => onCopy(saved)}>{I.copy}Copy</button>}
          </span>
          {dirty && (
            <span className="row-flex">
              <button type="button" className="btn sm quiet" onClick={() => setEdit(null)} disabled={busy}>Discard</button>
              <button type="button" className="btn sm primary" onClick={save} disabled={busy}>Save <kbd>Ctrl ↵</kbd></button>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function DayChart({ data }: { data: ReportData }) {
  const [hover, setHover] = useState<number | null>(null);
  const names = new Map(data.projects.map((p) => [p.id, p]));
  const order = data.projects.map((p) => p.id); // fixed project order, bottom to top
  const used = data.projects.filter((p) => data.days.some((d) => d.byProject[p.id]));
  const max = Math.max(60, ...data.days.map((d) => d.minutes));
  const n = data.days.length;
  const h = hover != null ? data.days[hover] : null;
  const lastDay = addDays(data.to, -1);
  const tipAlign = hover == null ? '' : hover < n * 0.2 ? 'left' : hover > n * 0.8 ? 'right' : 'center';
  const parts = (d: ReportData['days'][number]) => order.filter((id) => d.byProject[id]).map((id) => ({ p: names.get(id)!, min: d.byProject[id] }));
  const describe = (d: ReportData['days'][number]) =>
    `${fmtDay(d.day)}${isWeekend(d.day) ? ' (weekend)' : ''}: ${hrs(d.minutes)}${d.minutes ? `, ${parts(d).map((x) => `${x.p.name} ${hrs(x.min)}`).join(', ')}` : ''}`;

  return (
    <section className="section" aria-labelledby="daily-h">
      <div className="section-head"><h2 className="heading" id="daily-h">Hours per day</h2>
        <span className="row-flex small muted" style={{ gap: 12 }}>
          {used.map((p) => <span key={p.id} className="row-flex" style={{ gap: 6 }}><Dot color={p.color} />{p.name}</span>)}
          {data.days.some((d) => isWeekend(d.day)) && <span className="row-flex" style={{ gap: 6 }}><span className="dot weekend-swatch" />Weekend</span>}
        </span></div>
      <div className="card" style={{ padding: '16px 16px 10px' }}>
        <div className="daybars stacked" style={{ gap: n > 40 ? 2 : 4 }} onMouseLeave={() => setHover(null)}>
          <span className="axis-max small muted" aria-hidden="true">{hrs(max)}</span>
          {data.days.map((d, i) => (
            <div key={d.day} className={`b${isWeekend(d.day) ? ' weekend' : ''}${hover === i ? ' on' : ''}`} role="img" aria-label={describe(d)}
              onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              {d.minutes > 0 && (
                <div className="col" style={{ height: `${(d.minutes / max) * 100}%` }}>
                  {parts(d).reverse().map(({ p, min }) => <span key={p.id} style={{ flexGrow: min, background: p.color }} />)}
                </div>
              )}
            </div>
          ))}
          {h && (
            <div className={`bar-tip ${tipAlign}`} style={{ left: `${((hover! + 0.5) / n) * 100}%` }} aria-hidden="true">
              <div className="row-flex" style={{ justifyContent: 'space-between', gap: 16 }}>
                <b>{fmtDay(h.day)}{isWeekend(h.day) && <span className="muted" style={{ fontWeight: 400 }}> · weekend</span>}</b>
                <span className="mono-ink">{hrs(h.minutes)}</span>
              </div>
              {parts(h).map(({ p, min }) => (
                <div key={p.id} className="row-flex" style={{ justifyContent: 'space-between', gap: 16 }}>
                  <span className="row-flex" style={{ gap: 6 }}><Dot color={p.color} />{p.name}</span><span className="mono muted">{hrs(min)}</span>
                </div>
              ))}
              {!h.minutes && <span className="muted">No time logged</span>}
            </div>
          )}
          {data.stats.loggedMin === 0 && <p className="empty">No time logged in this {data.period} yet.</p>}
        </div>
        <div className="row-flex small muted" style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <span>{fmtDay(data.from)}</span><span>{fmtDay(lastDay)}</span>
        </div>
      </div>
    </section>
  );
}
function PlanTable({ rows }: { rows: ReportData['projects'] }) {
  const rowMax = Math.max(1, ...rows.map((p) => Math.max(p.targetMin, p.weekdayMin + p.weekendMin)));
  return (
    <div className="table-wrap">
      <table className="tickets">
        <thead><tr>
          <th scope="col">Project</th><th scope="col" style={{ width: '40%' }}>Logged vs planned</th>
          <th scope="col" className="num">Logged</th><th scope="col" className="num">Planned</th><th scope="col" className="num">Shipped</th>
        </tr></thead>
        <tbody>
          {rows.map((p) => {
            const logged = p.weekdayMin + p.weekendMin;
            return (
              <tr key={p.id} style={{ cursor: 'default' }}>
                <td><span className="row-flex" style={{ flexWrap: 'nowrap' }}><Dot color={p.color} />{p.name}</span></td>
                <td>
                  <div style={{ position: 'relative' }}>
                    <div className="track stacked" role="img" aria-label={`${hrs(logged)} logged, ${p.targetMin ? `${hrs(p.targetMin)} planned` : 'not planned'}`}>
                      {p.weekdayMin > 0 && <span style={{ width: `${(p.weekdayMin / rowMax) * 100}%`, background: p.color }} />}
                      {p.weekendMin > 0 && <span style={{ width: `${(p.weekendMin / rowMax) * 100}%`, background: WEEKEND }} />}
                    </div>
                    {p.targetMin > 0 && <span aria-hidden="true" style={{ position: 'absolute', top: -3, bottom: -3, width: 2, borderRadius: 1, background: 'var(--ink)', left: `calc(${(p.targetMin / rowMax) * 100}% - 1px)` }} />}
                  </div>
                </td>
                <td className="num"><span className={p.targetMin && p.weekdayMin > p.targetMin ? 'warn' : undefined}>{hrs(logged)}</span>
                  {p.weekendMin > 0 && <span className="muted"> ({hrs(p.weekendMin)} wknd)</span>}</td>
                <td className="num muted">{p.isOverhead ? 'overhead' : p.targetMin ? hrs(p.targetMin) : '—'}</td>
                <td className="num">{p.shipped || <span className="muted">0</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
