import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function Login() {
  const { isAuthenticated, login, loginError } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await login(username, password);
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-rb-bg px-4">
      <div className="mb-6 flex flex-col items-center text-center">
        <img src="/Brand_assets/logo_hitam_trnsparan.png" alt="Redbox Barbershop" className="mb-4 h-20 w-20 object-contain" />
        <img src="/Brand_assets/wordmark_hitam.png" alt="Redbox Barbershop" className="mb-2 h-8 object-contain" />
        <p className="mt-1 max-w-[320px] text-sm text-rb-text-muted">
          Backoffice — command center untuk seluruh operasional Redbox
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-[400px] rounded-3xl border border-rb-border bg-rb-surface p-8 shadow-[0_4px_24px_rgba(30,25,20,0.05)]">
        <label className="mb-1.5 block text-sm font-medium text-rb-text-secondary" htmlFor="username">Username / Email</label>
        <input
          id="username"
          type="email"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mb-4 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2.5 text-sm text-rb-text outline-none focus:border-rb-red"
          required
        />

        <label className="mb-1.5 block text-sm font-medium text-rb-text-secondary" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2.5 text-sm text-rb-text outline-none focus:border-rb-red"
          required
        />

        {loginError && <p className="mb-4 text-sm text-rb-red-tint-fg">{loginError}</p>}

        <button type="submit" disabled={submitting} className="w-full rounded-rb-button bg-rb-red py-2.5 text-sm font-semibold text-white transition hover:bg-rb-red-hover disabled:opacity-60">
          {submitting ? 'Memeriksa...' : 'Masuk ke Backoffice'}
        </button>

        <p className="mt-5 text-center text-[11.5px] leading-snug text-rb-text-faint">
          Akses khusus Owner dan tim internal Redbox yang berwenang.
        </p>
      </form>

      <p className="mt-6 text-[11px] text-rb-text-faint">© {new Date().getFullYear()} Redbox Barbershop</p>
    </div>
  );
}
