// The plan panel on the Week plan screen: how the week is split, the work week itself, and weekend opt-ins.
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { api, useAction } from '../lib/api.ts';
import { fmtDay } from '../lib/format.ts';
import { setParams } from '../lib/router.ts';
import type { WeekData } from '../lib/types.ts';
import { Dot } from '../components/bits.tsx';

type Tab = 'split' | 'week' | 'weekend';
const TABS: { id: Tab; label: string }[] = [
  { id: 'split', label: 'Split' }, { id: 'week', label: 'Work week' }, { id: 'weekend', label: 'Weekend' },
];
const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon–Fri", or "Mon, Wed, Fri". */
export function fmtWorkDays(days: number[]) {
  const order = DAYS.filter((d) => days.includes(d));
  const runs: number[][] = [];
  for (const d of order) {
    const last = runs.at(-1);
    if (last && (last.at(-1)! + 1) % 7 === d) last.push(d); else runs.push([d]);
  }
  return runs.map((r) => (r.length >= 3 ? `${SHORT[r[0]]}–${SHORT[r.at(-1)!]}` : r.map((d) => SHORT[d]).join(', '))).join(', ');
}

const num = (n: number, digits = 1) => String(+n.toFixed(digits));
const focusHours = (s: WeekData['settings']) => Math.max(0, s.weekHours - s.meetingHours);

export function Plan({ data, tab }: { data: WeekData; tab: string | null }) {
  const open = TABS.some((t) => t.id === tab) ? (tab as Tab) : null;
  const s = data.settings;
  const focus = focusHours(s);
  const name = (id: number | null) => data.projects.find((p) => p.id === id)?.name;
  const weekendText = (h: number, day: number, pid: number | null) =>
    h ? `${SHORT[day]} ${num(h)}h${pid ? ` on ${name(pid)}` : ''}` : null;
  const weekend = [weekendText(data.saturdayHours, 6, data.saturdayProjectId), weekendText(data.sundayHours, 0, data.sundayProjectId)]
    .filter(Boolean).join(', ');

  return (
    <section className="plan" aria-label="Plan for this week">
      <div className="plan-summary">
        <span className="small muted">
          <span className="mono-ink">{num(focus)}h</span> of project work, {fmtWorkDays(s.workDays)}
          {' '}(<span className="mono-ink">{num(focus / (s.workDays.length || 1))}h</span> a day)
          {s.meetingHours ? <>, after <span className="mono-ink">{num(s.meetingHours)}h</span> of meetings</> : null}
          {' · '}{data.weekOverride ? <span className="warn">this week has its own split</span> : 'usual split'}
          {' · '}{weekend ? <>weekend: <span className="mono-ink">{weekend}</span></> : 'weekend off'}
        </span>
        {!open && <button type="button" className="btn sm" onClick={() => setParams({ plan: 'split' })}>Edit plan</button>}
      </div>
      {open && (
        <div className="plan-panel card">
          <div className="row-flex plan-tabs" role="tablist" aria-label="Plan settings">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" className="chip" aria-selected={open === t.id} aria-pressed={open === t.id}
                aria-controls="plan-tabpanel" onClick={() => setParams({ plan: t.id })}>{t.label}</button>
            ))}
            <span className="spacer" />
            <button type="button" className="btn quiet sm" onClick={() => setParams({ plan: null })}>Close</button>
          </div>
          <div id="plan-tabpanel" role="tabpanel">
            {open === 'split' && <Split data={data} />}
            {open === 'week' && <WorkWeek data={data} />}
            {open === 'weekend' && <Weekend data={data} />}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- split ----------

function Split({ data }: { data: WeekData }) {
  const { run, busy } = useAction();
  const [scope, setScope] = useState<'week' | 'every'>(data.weekOverride ? 'week' : 'every');
  const base = useMemo(
    () => new Map(data.shares.map((x) => [x.projectId, num(scope === 'week' ? x.pct : x.usualPct)])),
    [data.shares, scope],
  );
  const [draft, setDraftRaw] = useState(base);
  const [touched, setTouched] = useState(false);
  const setDraft = (d: Map<number, string>) => { setDraftRaw(d); setTouched(true); };
  const reset = () => { setDraftRaw(base); setTouched(false); };
  const dirty = touched && [...draft].some(([id, v]) => Number(v) !== Number(base.get(id)));
  // Live updates and scope switches load fresh numbers, unless there are unsaved edits (those carry over).
  useEffect(() => { if (!touched) setDraftRaw(base); }, [base, touched]);

  const value = (id: number) => Math.max(0, Number(draft.get(id)) || 0);
  const total = data.shares.reduce((n, x) => n + value(x.projectId), 0);
  const fits = Math.abs(total - 100) < 0.5;
  const focus = focusHours(data.settings);
  const perDay = focus / (data.settings.workDays.length || 1);
  const overhead = data.projects.filter((p) => p.isOverhead);

  /** Keeps the rows you edited and scales the others to fill the rest. Falls back to scaling every row. */
  const edited = (id: number) => Number(draft.get(id)) !== Number(base.get(id));
  const lockedSum = data.shares.filter((x) => edited(x.projectId)).reduce((n, x) => n + value(x.projectId), 0);
  const restSum = total - lockedSum;
  const fitRest = lockedSum > 0 && lockedSum <= 100 && restSum > 0;
  function fit() {
    if (!total) return;
    setDraft(new Map(data.shares.map((x) => {
      const v = value(x.projectId);
      if (!fitRest) return [x.projectId, num((v / total) * 100)];
      return [x.projectId, edited(x.projectId) ? String(v) : num((v / restSum) * (100 - lockedSum), 2)];
    })));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!fits) return;
    const shares = Object.fromEntries(data.shares.map((x) => [x.projectId, (value(x.projectId) / total) * 100]));
    const ok = await run(() => api.put('/api/shares', scope === 'week' ? { shares, week: data.weekStart } : { shares }),
      scope === 'week' ? `Saved the split for the week of ${fmtDay(data.weekStart)}.` : 'Saved the usual split.');
    if (ok) setTouched(false);
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={save} aria-label="Split the week between projects">
      <div className="row-flex">
        <span className="small muted">Applies to</span>
        <div className="row-flex" role="radiogroup" aria-label="Which weeks" style={{ gap: 6 }}>
          <button type="button" role="radio" className="chip" aria-checked={scope === 'week'} aria-pressed={scope === 'week'}
            onClick={() => setScope('week')}>This week only</button>
          <button type="button" role="radio" className="chip" aria-checked={scope === 'every'} aria-pressed={scope === 'every'}
            onClick={() => setScope('every')}>Every week</button>
        </div>
      </div>

      <div className="split-rows">
        <div className="split-row head small muted" aria-hidden="true">
          <span>Project</span><span /><span className="num">Share</span><span className="num">Week</span><span className="num">Day</span>
        </div>
        {data.shares.map((x) => {
          const p = data.projects.find((q) => q.id === x.projectId)!;
          const v = value(x.projectId);
          const changed = touched && Number(draft.get(x.projectId)) !== Number(base.get(x.projectId));
          return (
            <div key={p.id} className="split-row">
              <label htmlFor={`share-${p.id}`} className="name"><Dot color={p.color} /><span>{p.name}</span></label>
              <input type="range" min={0} max={100} step={0.5} value={v} aria-label={`${p.name} share, percent`}
                style={{ '--c': p.color, '--fill': `${Math.min(100, v)}%` } as CSSProperties}
                onChange={(e) => setDraft(new Map(draft).set(p.id, e.target.value))} />
              <span className="pct">
                <input id={`share-${p.id}`} className={`input mono${changed ? ' changed' : ''}`} type="number" min={0} max={100} step={0.1}
                  inputMode="decimal" value={draft.get(p.id) ?? ''} onChange={(e) => setDraft(new Map(draft).set(p.id, e.target.value))} />
                <span className="muted">%</span>
              </span>
              <span className="num mono">{num((v / 100) * focus)}h</span>
              <span className="num mono muted">{num((v / 100) * perDay)}h</span>
            </div>
          );
        })}
      </div>

      <div className="row-flex">
        <span className={`small ${fits ? 'muted' : 'warn'}`} role="status">
          {fits ? <>Adds up to <span className="mono-ink">100%</span>.</>
            : <>Adds up to <span className="mono">{num(total)}%</span>. It needs to add up to 100%.</>}
        </span>
        {!fits && total > 0 && <button type="button" className="btn sm" onClick={fit}>{fitRest ? 'Fit the others to 100%' : 'Scale to 100%'}</button>}
        <span className="spacer" />
        {dirty && <button type="button" className="btn quiet" onClick={reset}>Undo changes</button>}
        {scope === 'week' && data.weekOverride && !dirty && (
          <button type="button" className="btn quiet" disabled={busy}
            onClick={() => run(() => api.del(`/api/shares?week=${data.weekStart}`), 'This week is back on the usual split.')}>
            Use the usual split
          </button>
        )}
        <button type="submit" className="btn primary" disabled={busy || !dirty || !fits}>Save split</button>
      </div>
      <p className="hint">
        {scope === 'week'
          ? `Only the week of ${fmtDay(data.weekStart)} changes. Other weeks keep the usual split.`
          : data.weekOverride
            ? 'Changes the usual split for every week. This week has its own split, so it stays as it is.'
            : 'Changes the usual split for every week, including past weeks in reports.'}
        {overhead.length > 0 && ` ${overhead.map((p) => p.name).join(', ')} is overhead and never gets planned hours.`}
      </p>
    </form>
  );
}

// ---------- work week ----------

function WorkWeek({ data }: { data: WeekData }) {
  const { run, busy } = useAction();
  const s = data.settings;
  const [hours, setHours] = useState(String(s.weekHours));
  const [meetings, setMeetings] = useState(String(s.meetingHours));
  const [days, setDays] = useState<number[]>(s.workDays);
  const h = Number(hours) || 0;
  const m = Number(meetings) || 0;
  const valid = h > 0 && h <= 100 && m >= 0 && m < h && days.length > 0;
  const dirty = h !== s.weekHours || m !== s.meetingHours || [...days].sort().join() !== [...s.workDays].sort().join();
  const focus = Math.max(0, h - m);

  async function save(e: FormEvent) {
    e.preventDefault();
    await run(() => api.patch('/api/settings', { weekHours: h, meetingHours: m, workDays: days }), 'Work week saved.');
  }
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={save} aria-label="Work week">
      <div className="row-flex" style={{ alignItems: 'flex-end', gap: 16 }}>
        <label className="field" style={{ width: 140 }}><span>Hours a week</span>
          <input className="input mono" type="number" min={1} max={100} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        <label className="field" style={{ width: 140 }}><span>Meetings a week</span>
          <input className="input mono" type="number" min={0} max={99} step={0.5} value={meetings} onChange={(e) => setMeetings(e.target.value)} /></label>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Work days</span>
          <div className="row-flex" style={{ gap: 6 }}>
            {DAYS.map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={days.includes(d)}
                onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}>{SHORT[d]}</button>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="row-flex">
        <span className={`small ${valid ? 'muted' : 'warn'}`} role="status">
          {!days.length ? 'Pick at least one work day.'
            : m >= h ? 'Meetings must be less than the whole week.'
              : <>That leaves <span className="mono-ink">{num(focus)}h</span> of project work, <span className="mono-ink">{num(focus / days.length, 2)}h</span> a day.</>}
        </span>
        <span className="spacer" />
        {dirty && <button type="button" className="btn quiet" onClick={() => { setHours(String(s.weekHours)); setMeetings(String(s.meetingHours)); setDays(s.workDays); }}>Undo changes</button>}
        <button type="submit" className="btn primary" disabled={busy || !dirty || !valid}>Save work week</button>
      </div>
      <p className="hint">This is your usual week. It applies to every week, past ones in reports too. Meetings come off the top before the split.</p>
    </form>
  );
}

// ---------- weekend ----------

function Weekend({ data }: { data: WeekData }) {
  const { run, busy } = useAction();
  const init = () => ({
    sat: String(data.saturdayHours), sun: String(data.sundayHours),
    satP: data.saturdayProjectId ? String(data.saturdayProjectId) : '', sunP: data.sundayProjectId ? String(data.sundayProjectId) : '',
  });
  const [f, setF] = useState(init);
  const planned = data.projects.filter((p) => !p.isOverhead);
  const satWork = data.settings.workDays.includes(6);
  const sunWork = data.settings.workDays.includes(0);
  const dirty = JSON.stringify(f) !== JSON.stringify(init());

  async function save(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { day: data.weekStart };
    if (!satWork) Object.assign(body, { saturdayHours: Number(f.sat) || 0, saturdayProjectId: f.satP ? Number(f.satP) : null });
    if (!sunWork) Object.assign(body, { sundayHours: Number(f.sun) || 0, sundayProjectId: f.sunP ? Number(f.sunP) : null });
    await run(() => api.post('/api/week/weekend', body), 'Weekend saved.');
  }
  const day = (label: string, idx: 5 | 6, work: boolean, hk: 'sat' | 'sun', pk: 'satP' | 'sunP') => (
    <div className="row-flex" style={{ alignItems: 'flex-end', gap: 12 }}>
      <label className="field" style={{ width: 150 }}><span>{label} {fmtDay(data.days[idx]).replace(/^\w+ /, '')}, hours</span>
        <input className="input mono" type="number" min={0} max={16} step={0.5} value={work ? '' : f[hk]} disabled={work}
          placeholder={work ? 'work day' : undefined} onChange={(e) => setF({ ...f, [hk]: e.target.value })} /></label>
      <label className="field" style={{ width: 240 }}><span>On</span>
        <select className="select" value={f[pk]} disabled={work || !(Number(f[hk]) > 0)} onChange={(e) => setF({ ...f, [pk]: e.target.value })}>
          <option value="">Split like a work day</option>
          {planned.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
    </div>
  );
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={save} aria-label="Weekend hours">
      {day('Saturday', 5, satWork, 'sat', 'satP')}
      {day('Sunday', 6, sunWork, 'sun', 'sunP')}
      <div className="row-flex">
        <span className="spacer" />
        {(data.saturdayHours > 0 || data.sundayHours > 0) && !dirty && (
          <button type="button" className="btn quiet" disabled={busy}
            onClick={() => run(() => api.post('/api/week/weekend', { day: data.weekStart, saturdayHours: 0, sundayHours: 0 }), 'Weekend is off again.')}>
            Turn the weekend off
          </button>
        )}
        {dirty && <button type="button" className="btn quiet" onClick={() => setF(init())}>Undo changes</button>}
        <button type="submit" className="btn primary" disabled={busy || !dirty}>Save weekend</button>
      </div>
      <p className="hint">
        Weekend hours are extra, on top of your {num(data.settings.weekHours)}h, and only count for the week of {fmtDay(data.weekStart)}.
        You can log weekend time without planning it.{(satWork || sunWork) && ' Weekend days in your work week are planned like any work day.'}
      </p>
    </form>
  );
}
