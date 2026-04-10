import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from '../auth/AdminContext';

export default function AdminLogin() {
  const nav = useNavigate();
  const { login, loading } = useAdmin();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) return setError('Username is required');
    if (!password.trim()) return setError('Password is required');
    setBusy(true);
    try {
      await login({ username: username.trim(), password });
      nav('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app" style={{ minHeight: '100vh' }}>
      <main className="main" style={{ padding: '1.5rem 1rem' }}>
        <h1 className="page-title">Admin login</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: '1rem' }}>
          Sign in to manage team permissions, LPOs/IPRs, and payments.
        </p>
        <div className="card">
          <form className="body" onSubmit={submit}>
            <div className="form-group">
              <label>Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div role="alert" style={{ marginTop: '0.75rem', color: 'var(--danger)' }}>
                {error}
              </div>
            )}
            <footer style={{ marginTop: '1rem' }}>
              <button type="submit" className="btn primary" disabled={busy || loading}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </footer>
          </form>
        </div>
      </main>
    </div>
  );
}

