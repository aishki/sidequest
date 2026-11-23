import { api, useAction, useConnected } from '../lib/api.ts';
import { clock, fmtLongDay, hrs, weekNo } from '../lib/format.ts';
import { href, openTicket, type Screen } from '../lib/router.ts';
import type { Summary } from '../lib/types.ts';
import { Dot, useNow } from './bits.tsx';
import { I, Logo } from './icons.tsx';

const NAV: { screen: Screen; label: string; icon: keyof typeof I; count?: (s: Summary) => number }[] = [
  { screen: 'today', label: 'Today', icon: 'today', count: (s) => s.counts.today },
  { screen: 'board', label: 'Board', icon: 'board', count: (s) => s.counts.open },
  { screen: 'projects', label: 'Projects', icon: 'projects' },
  { screen: 'week', label: 'Week plan', icon: 'week' },
  { screen: 'reports', label: 'Reports', icon: 'reports' },
  { screen: 'tickets', label: 'All tickets', icon: 'list', count: (s) => s.counts.all },
];

export function Sidebar({ screen, summary, projectFilter, onFind }: {
  screen: Screen; summary?: Summary; projectFilter: string | null; onFind: () => void;
}) {
  const connected = useConnected();
  return (
    <nav className="side" aria-label="Main">
      <div className="brand">
        <Logo /><span className="brand-name">sidequest</span>
        {summary && <span className="brand-week" title={`Week of ${fmtLongDay(summary.week.start)}`}>W{weekNo(summary.today)}</span>}
      </div>
      <button type="button" className="finder" onClick={onFind} aria-keyshortcuts="/ Control+K">
        {I.search}<span style={{ flex: 1 }}>Add or find…</span><kbd>/</kbd>
      </button>
      {NAV.map((n) => (
        <a key={n.screen} className="navlink" href={href(n.screen)} aria-current={screen === n.screen ? 'page' : undefined}>
          {I[n.icon]}<span>{n.label}</span>
          {summary && n.count && <span className="count">{n.count(summary)}</span>}
        </a>
      ))}

      {summary && summary.projects.length > 0 && <div className="side-label label-caps">Projects</div>}
      {summary?.projects.map((p) => (
        <a key={p.id} className="navlink project" href={href('board', { project: String(p.id) })}
          aria-current={screen === 'board' && projectFilter === String(p.id) ? 'page' : undefined}>
          <Dot color={p.color} /><span className="name">{p.name}</span><span className="count">{p.open || ''}</span>
        </a>
      ))}

      <div className="side-foot">
        {!connected && <div className="offline" role="alert">Lost connection to the dashboard server. Retrying…</div>}
        {summary && <TimerCard summary={summary} />}
        {summary && <WeekCard summary={summary} />}
      </div>
    </nav>
  );
}

function TimerCard({ summary }: { summary: Summary }) {
  const t = summary.timer;
  const now = useNow(1000);
  const { run, busy } = useAction();
  if (!t) return null;
  const label = t.ticket ? t.ticket.key : t.project.name;
  return (
    <section className="side-card" aria-label="Running timer">
      <div className="line"><span className="muted">Timer</span><span className="mono" style={{ color: 'var(--ochre)' }}>{clock(now - new Date(t.startedAt).getTime())}</span></div>
      <button type="button" className="btn quiet sm" style={{ justifyContent: 'flex-start', padding: 0, minHeight: 0, fontWeight: 500 }}
        onClick={() => t.ticket && openTicket(t.ticket.key)} disabled={!t.ticket} title={t.ticket?.title}>
        <Dot color={t.project.color} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}{t.ticket ? ` · ${t.ticket.title}` : ''}</span>
      </button>
      <div className="row-flex">
        <button type="button" className="btn sm" disabled={busy} onClick={() => run(() => api.post<{ minutes: number }>('/api/timer/stop'), 'Timer stopped and logged.')}>
          {I.stop}Stop
        </button>
        <button type="button" className="btn quiet sm" disabled={busy} onClick={() => run(() => api.post('/api/timer/cancel'), 'Timer discarded, nothing logged.')}>
          Discard
        </button>
      </div>
    </section>
  );
}

function WeekCard({ summary }: { summary: Summary }) {
  const { loggedMin, targetMin, todayLeftMin } = summary.week;
  const total = Math.max(targetMin, loggedMin, 1);
  const logged = summary.projects.filter((p) => p.loggedMin > 0);
  return (
    <section className="side-card week" aria-label="This week">
      <div className="line"><span className="muted">This week</span><span className="mono">{hrs(loggedMin)} / {hrs(targetMin)}</span></div>
      <div className="track thin stacked" role="img" aria-label={`${hrs(loggedMin)} of ${hrs(targetMin)} logged this week`}>
        {logged.map((p) => <span key={p.id} style={{ width: `${(p.loggedMin / total) * 100}%`, background: p.color }} title={`${p.name}: ${hrs(p.loggedMin)}`} />)}
      </div>
      <div className="small muted">
        {todayLeftMin > 0 ? <><span className="mono">{hrs(todayLeftMin)}</span> planned time left today</> : 'Today\'s plan is covered.'}
      </div>
    </section>
  );
}
