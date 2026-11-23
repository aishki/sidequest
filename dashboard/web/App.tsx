import { useEffect, useState } from 'react';
import { useApi } from './lib/api.ts';
import { useRoute } from './lib/router.ts';
import type { Summary } from './lib/types.ts';
import { Toasts } from './components/bits.tsx';
import { CommandBar } from './components/CommandBar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TicketDrawer } from './components/TicketDrawer.tsx';
import { Board } from './screens/Board.tsx';
import { Projects } from './screens/Projects.tsx';
import { Reports } from './screens/Reports.tsx';
import { Tickets } from './screens/Tickets.tsx';
import { Today } from './screens/Today.tsx';
import { Week } from './screens/Week.tsx';

const TITLES = { today: 'Today', board: 'Board', projects: 'Projects', week: 'Week plan', reports: 'Reports', tickets: 'All tickets' };

export function App() {
  const { screen, params } = useRoute();
  const { data: summary } = useApi<Summary>('/api/summary');
  const [finding, setFinding] = useState(false);
  const ticket = params.get('t');

  useEffect(() => { document.title = `${ticket ? `${ticket} · ` : ''}${TITLES[screen]} · sidequest`; }, [screen, ticket]);

  // "/" or Ctrl/Cmd+K opens Add or find, unless you're typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        setFinding(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const find = () => setFinding(true);
  return (
    <div className="app">
      <Sidebar screen={screen} summary={summary} projectFilter={params.get('project')} onFind={find} />
      <main className="main" id="main">
        {screen === 'today' && <Today summary={summary} onFind={find} />}
        {screen === 'board' && <Board summary={summary} params={params} />}
        {screen === 'projects' && <Projects />}
        {screen === 'week' && <Week params={params} />}
        {screen === 'reports' && <Reports params={params} />}
        {screen === 'tickets' && <Tickets summary={summary} params={params} />}
      </main>
      {ticket && <TicketDrawer key={ticket} ticketKey={ticket} summary={summary} />}
      {finding && <CommandBar summary={summary} onClose={() => setFinding(false)} defaultProject={screen === 'board' ? params.get('project') : null} />}
      <Toasts />
    </div>
  );
}
