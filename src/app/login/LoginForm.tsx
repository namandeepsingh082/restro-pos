'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, ApiError } from '@/lib/client/api';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const data = await post<{ redirect: string }>('/api/auth/login', { email, password });
      const next = params.get('next');
      router.replace(next && next.startsWith('/') ? next : data.redirect);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cannot reach the server.');
      setBusy(false);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-4">
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="field"
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && signIn()}
        />
      </div>
      <div className="mb-4">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="field"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && signIn()}
        />
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded border border-nonveg/30 bg-red-50 px-3 py-2 text-sm text-nonveg">
          {error}
        </p>
      )}

      <button className="btn-primary btn-lg w-full" onClick={signIn} disabled={busy || !email || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </div>
  );
}
