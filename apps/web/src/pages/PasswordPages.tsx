import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { passwordForgotSchema } from '@mboka/shared';
import { ErrorMessage } from '../components/ui';
import { api } from '../lib/api';
import { PublicShell } from './SignupPage';

const field = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2';

/** "Forgot password": always ends on "check your inbox", whether or not the address has an account. */
export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: (body: { email: string; locale: 'fr' | 'en' }) => api('/auth/password/forgot', { method: 'POST', body }) });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = passwordForgotSchema.safeParse({ email, locale: i18n.language.startsWith('en') ? 'en' : 'fr' });
    if (parsed.success) send.mutate({ email: parsed.data.email, locale: parsed.data.locale ?? 'fr' });
  }

  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold">{t('password.forgotTitle')}</h1>
      {send.isSuccess ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-success-600">
          {t('password.forgotSent', { email })}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-slate-600">{t('password.forgotHelp')}</p>
          <label className="block">
            <span className="text-sm font-medium">{t('auth.email')}</span>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </label>
          <ErrorMessage error={send.error} />
          <button type="submit" disabled={send.isPending || !email} className="w-full rounded-md bg-action-600 px-4 py-2 font-medium text-white hover:bg-action-700 disabled:opacity-60">
            {send.isPending ? t('common.loading') : t('password.forgotSubmit')}
          </button>
        </form>
      )}
      <Link to="/" className="inline-block font-medium text-accent-700 hover:underline">
        {t('signup.backToLogin')}
      </Link>
    </PublicShell>
  );
}

/**
 * Opened from an e-mailed link: a password reset (`/reset-password`) or an invitation (`/accept-invitation`).
 * The token travels in the fragment, which browsers never send to servers or their logs.
 */
export function SetPasswordPage({ mode }: { mode: 'reset' | 'invitation' }) {
  const { t } = useTranslation();
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const [f, setF] = useState({ newPassword: '', confirm: '' });
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api('/auth/password/reset', { method: 'POST', body: { token, newPassword: f.newPassword } }),
    // Every session was signed out, this browser's included.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const mismatch = f.confirm.length > 0 && f.confirm !== f.newPassword;

  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold">{t(mode === 'reset' ? 'password.resetTitle' : 'password.inviteTitle')}</h1>
      {!token ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger-600">
          {t('errors.INVALID_RESET_LINK')}
        </p>
      ) : save.isSuccess ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-success-600">
          {t('password.saved')}
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!mismatch) save.mutate();
          }}
        >
          {mode === 'invitation' && <p className="text-sm text-slate-600">{t('password.inviteHelp')}</p>}
          <label className="block">
            <span className="text-sm font-medium">{t('account.newPassword')}</span>
            <input type="password" autoComplete="new-password" minLength={10} required value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} className={field} />
            <span className="mt-1 block text-xs text-slate-500">{t('account.passwordHint')}</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('account.confirmPassword')}</span>
            <input type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} aria-invalid={mismatch} className={field} />
          </label>
          {mismatch && <p className="text-sm text-danger-600">{t('account.mismatch')}</p>}
          <ErrorMessage error={save.error} />
          <button
            type="submit"
            disabled={save.isPending || mismatch || f.newPassword.length < 10}
            className="w-full rounded-md bg-action-600 px-4 py-2 font-medium text-white hover:bg-action-700 disabled:opacity-60"
          >
            {save.isPending ? t('common.loading') : t('password.save')}
          </button>
        </form>
      )}
      {(save.error || !token) && (
        <Link to="/forgot-password" className="mr-4 inline-block font-medium text-accent-700 hover:underline">
          {t('password.newLink')}
        </Link>
      )}
      <Link to="/" className="inline-block font-medium text-accent-700 hover:underline">
        {t('signup.toLogin')}
      </Link>
    </PublicShell>
  );
}
