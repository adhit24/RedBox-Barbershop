import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function Login() {
  const { isAuthenticated, login, loginError } = useAuth();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await login(password);
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-rb-bg px-4">
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-rb-red font-serif text-xl font-semibold text-white">
          R
        </div>
        <h1 className="font-serif text-2xl font-semibold text-rb-text">Redbox Backoffice</h1>
        <p className="mt-1 max-w-[320px] text-sm text-rb-text-muted">
          Command center untuk seluruh operasional Redbox
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[400px] rounded-3xl border border-rb-border bg-rb-surface p-8 shadow-[0_4px_24px_rgba(30,25,20,0.05)]"
      >
        <label className="mb-1.5 block text-sm font-medium text-rb-text-secondary" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-1 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2.5 text-sm text-rb-text outline-none focus:border-rb-red"
          required
        />
        <p className="mb-4 text-[11px] text-rb-text-faint">
          Login sementara — memakai kredensial admin bersama yang sudah dipakai
          production (bukan RBAC final per-user).
        </p>

        {loginError && <p className="mb-4 text-sm text-rb-red-tint-fg">{loginError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-rb-button bg-rb-red py-2.5 text-sm font-semibold text-white transition hover:bg-rb-red-hover disabled:opacity-60"
        >
          {submitting ? 'Memeriksa...' : 'Masuk ke Backoffice'}
        </button>

        <p className="mt-5 text-center text-[11.5px] leading-snug text-rb-text-faint">
          Akses ini khusus untuk Owner dan tim internal Redbox yang berwenang.
          <br />
          Setiap akses tercatat untuk keperluan audit.
        </p>
      </form>

      <p className="mt-6 text-[11px] text-rb-text-faint">
        © {new Date().getFullYear()} Redbox Barbershop
      </p>
    </div>
  );
}
