import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loginSchema } from '@mboka/shared';
import { Link } from 'react-router';
import { api, ApiRequestError, setCsrfToken } from '../lib/api';
import { LegalFooter } from '../lib/platform-status';
import { PlatformName } from './SignupPage';

const field = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-100';

export function LoginPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const resend = useMutation({ mutationFn: () => api('/signup/resend', { method: 'POST', body: { email } }) });
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
    ? login.error.status === 429 ? t('auth.rateLimited') : login.error.status === 401 ? t('auth.invalid') : login.error.code === 'EMAIL_NOT_VERIFIED' ? t('auth.notVerified') : t('common.errorGeneric')
    : login.error ? t('common.errorGeneric') : null;

  return (
    <div className="grid min-h-dvh bg-slate-50 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* The green half carries the brand; on phones it shrinks to a band above the form. */}
      <section className="flex flex-col justify-between bg-forest-900 px-6 py-6 text-white md:px-12 md:py-12">
        <PlatformName dark />
        <div className="hidden max-w-md md:block">
          <p className="text-[2.6rem] font-extrabold leading-[1.08] text-white">{t('auth.panelTitle')}</p>
          <p className="mt-5 text-base leading-relaxed text-white/70">{t('auth.panelBody')}</p>
        </div>
        <div className="hidden md:block">
          <LegalFooter dark />
        </div>
      </section>

      <div className="flex flex-col justify-center px-4 py-10 md:px-12">
        <form onSubmit={submit} className="mx-auto w-full max-w-sm space-y-5" noValidate>
          <div>
            <h1 className="text-[1.85rem] font-bold leading-tight">{t('auth.title')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('auth.subtitle')}</p>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">{t('auth.email')}</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">{t('auth.password')}</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </label>

          <p className="-mt-3 text-right text-sm">
            <Link to="/forgot-password" className="font-medium text-accent-700 hover:underline">
              {t('auth.forgot')}
            </Link>
          </p>

          {error && (
            <p role="alert" className="rounded-md border-l-4 border-danger-600 bg-red-50 px-3 py-2 text-sm text-danger-600">
              {error}
            </p>
          )}
          {login.error instanceof ApiRequestError && login.error.code === 'EMAIL_NOT_VERIFIED' && (
            <button type="button" disabled={resend.isPending || resend.isSuccess} onClick={() => resend.mutate()} className="text-sm font-medium text-accent-700 hover:underline disabled:opacity-60">
              {resend.isSuccess ? t('auth.resent') : t('auth.resend')}
            </button>
          )}

          <button
            type="submit"
            disabled={login.isPending || !email || !password}
            className="w-full rounded-md bg-action-600 px-4 py-2.5 font-semibold text-white hover:bg-action-700 disabled:opacity-60"
          >
            {login.isPending ? t('common.loading') : t('auth.submit')}
          </button>
          <p className="border-t border-slate-200 pt-5 text-sm text-slate-600">
            {t('auth.newSchool')}{' '}
            <Link to="/signup" className="font-semibold text-accent-700 hover:underline">
              {t('auth.signup')}
            </Link>
          </p>
        </form>
        <div className="md:hidden">
          <LegalFooter />
        </div>
      </div>
    </div>
  );
}
