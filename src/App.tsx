import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Clock3, LoaderCircle, LogOut, PenLine, Settings, Users as UsersIcon } from 'lucide-react';
import { config, logout, session, whenSignedOut } from './api';
import Login from './components/Login';
import { MailStatusBanner } from './components/SendChecklist';

const History = lazy(() => import('./components/History'));
const SettingsDialog = lazy(() => import('./components/SettingsDialog'));
const MailPage = lazy(() => import('./components/MailPage'));
const Schedules = lazy(() => import('./components/Schedules'));
const Users = lazy(() => import('./components/Users'));
type Tab = 'compose' | 'schedules' | 'users' | 'history';
const pages: Record<Tab, { title: string; text: string }> = {
  compose: { title: 'Send mail', text: 'Each selected user receives a separate email with their own PDF.' },
  schedules: { title: 'Daily schedules', text: 'Send the PDFs automatically at set times, once or several times a day.' },
  users: { title: 'Users', text: 'The user list that the Company and User fields are filled from.' },
  history: { title: 'History', text: 'Every email sent from this portal, with its status.' },
};
const loading = <div className="composer skeleton-list"><i/><i/><i/></div>;

function Brand() { return <div className="brand"><span className="brand-monogram">KG<span>◆</span></span><span><strong>KG GIRDHARLAL</strong><small>EMPLOYEE EMAIL PORTAL</small></span></div>; }

/** Shows the sign-in screen until there is a valid session. */
export default function App() {
  const client = useQueryClient();
  const auth = useQuery({ queryKey: ['session'], queryFn: session, staleTime: Infinity });
  useEffect(() => whenSignedOut(() => client.setQueryData(['session'], { username: null })), [client]);
  if (auth.isPending) return <div className="app-loading"><Brand/><LoaderCircle className="spin"/></div>;
  if (auth.isError) return <div className="app-loading"><Brand/><p className="banner error" role="alert">{auth.error.message}</p><button className="secondary" onClick={() => auth.refetch()}>Try again</button></div>;
  if (!auth.data.username) return <Login onSignedIn={() => { client.removeQueries({ predicate: q => q.queryKey[0] !== 'session' }); auth.refetch(); }}/>;
  return <Portal username={auth.data.username} onSignOut={async () => { await logout().catch(() => {}); client.clear(); client.setQueryData(['session'], { username: null }); }}/>;
}

function Portal({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('compose');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const current = useQuery({ queryKey: ['config'], queryFn: config, staleTime: 60000 });
  const profile = current.data;
  if (current.isPending) return <div className="app-loading"><Brand/><LoaderCircle className="spin"/><p>Opening your workspace…</p></div>;
  if (!profile) return <div className="app-loading"><Brand/><p className="banner error" role="alert">{current.error?.message || 'The portal service is not available.'}</p><button className="secondary" onClick={() => current.refetch()}>Try again</button></div>;
  const nav = ([['compose', PenLine], ['schedules', CalendarClock], ['users', UsersIcon], ['history', Clock3]] as [Tab, typeof PenLine][])
    .filter(([id]) => id !== 'schedules' || profile.schedulesEnabled);
  return <div className="app-shell">
    <aside className="sidebar"><Brand/>
      <nav aria-label="Main navigation">{nav.map(([id, Icon]) => <button key={id} type="button" className={tab === id ? 'nav-item selected' : 'nav-item'} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={18}/><span>{pages[id].title}</span></button>)}</nav>
      <div className="sidebar-status" title={profile.mailStatus.detail}><span className={`status-dot ${profile.mailEnabled ? 'on' : 'off'}`}/><span><strong>{profile.mailEnabled ? 'Sending on' : 'Sending off'}</strong><small>{profile.sender}</small></span>
        <button type="button" className="icon-button settings-button" aria-label="Settings: senders, CC and mail templates" title="Settings: senders, CC and mail templates" onClick={() => setSettingsOpen(true)}><Settings size={16}/></button>
        <button type="button" className="icon-button sign-out" aria-label={`Sign out ${username}`} title={`Sign out (${username})`} onClick={onSignOut}><LogOut size={16}/></button></div>
    </aside>
    <main className="main-content">
      <header className="page-head"><h1>{pages[tab].title}</h1><p>{pages[tab].text}</p></header>
      <MailStatusBanner profile={profile}/>
      <div className={tab === 'compose' ? '' : 'hidden'}><Suspense fallback={loading}><MailPage profile={profile}/></Suspense></div>
      {tab === 'users' && <Suspense fallback={loading}><Users/></Suspense>}
      {tab === 'schedules' && <Suspense fallback={loading}><Schedules profile={profile}/></Suspense>}
      {tab === 'history' && <Suspense fallback={loading}><History/></Suspense>}
      {settingsOpen && <Suspense fallback={null}><SettingsDialog profile={profile} onClose={() => setSettingsOpen(false)}/></Suspense>}
      <footer className="main-footer">© {new Date().getFullYear()} KG Girdharlal · Internal use only</footer>
    </main>
  </div>;
}
