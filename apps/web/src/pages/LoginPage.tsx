import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loginSchema } from '@mboka/shared';
import { api, ApiRequestError, setCsrfToken } from '../lib/api';

export function LoginPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api<{ csrfToken: string }>('/auth/login', { method: 'POST', body }),
    onSuccess: async (res) => {
      setCsrfToken(res.csrfToken);
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (parsed.success) login.mutate(parsed.data);
  }

  const error = login.error instanceof ApiRequestError
    ? login.error.status === 429 ? t('auth.rateLimited') : login.error.status === 401 ? t('auth.invalid') : t('common.errorGeneric')
    : login.error ? t('common.errorGeneric') : null;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy-900 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl bg-white p-8 shadow-lg" noValidate>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent-600">{t('app.name')}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t('auth.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('auth.subtitle')}</p>
        </div>

        <label className="block">
          <span className="text-sm font-medium">{t('auth.email')}</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t('auth.password')}</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending || !email || !password}
          className="w-full rounded-md bg-accent-600 px-4 py-2 font-medium text-white hover:bg-accent-700 disabled:opacity-60"
        >
          {login.isPending ? t('common.loading') : t('auth.submit')}
        </button>
      </form>
    </div>
  );
}
