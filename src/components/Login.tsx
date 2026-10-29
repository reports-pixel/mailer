import { useState } from 'react';
import { LoaderCircle, LockKeyhole, LogIn } from 'lucide-react';
import { login } from '../api';

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    setBusy(true);
    try { await login(username.trim(), password); onSignedIn(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed.'); setPassword(''); }
    finally { setBusy(false); }
  };
  return <main className="login-page">
    <form className="login-card" onSubmit={submit} noValidate>
      <div className="brand"><span className="brand-monogram">KG<span>◆</span></span><span><strong>KG GIRDHARLAL</strong><small>EMPLOYEE EMAIL PORTAL</small></span></div>
      <div><h1>Sign in</h1><p className="hint">Send each employee their own documents by email.</p></div>
      <div><label htmlFor="login-user">Username</label><input id="login-user" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus/></div>
      <div><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></div>
      {error && <p className="banner error" role="alert"><LockKeyhole size={16}/><span>{error}</span></p>}
      <button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <LogIn size={17}/>}{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </main>;
}
