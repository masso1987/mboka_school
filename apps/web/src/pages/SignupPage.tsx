import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { signupSchema } from '@mboka/shared';
import { ErrorMessage } from '../components/ui';
import { api } from '../lib/api';
import { useMoney } from '../lib/money';

export interface PublicPlan {
  code: string;
  nameFr: string;
  nameEn: string;
  descriptionFr: string | null;
  descriptionEn: string | null;
  monthlyPrice: string;
  annualPrice: string;
  maxStudents: number;
  maxCampuses: number;
  maxUsers: number;
}

function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-start justify-center bg-navy-900 px-4 py-10">
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'} space-y-5 rounded-xl bg-white p-6 shadow-lg sm:p-8`}>
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-600">{t('app.name')}</p>
        {children}
      </div>
    </div>
  );
}

const field = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2';

/** Self-service school sign-up: plan, school, owner account; then "check your inbox". */
export function SignupPage() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: () => api<PublicPlan[]>('/public/plans') });
  const [f, setF] = useState({ schoolName: '', city: '', ownerName: '', ownerEmail: '', phone: '', password: '', plan: 'standard', acceptTerms: false, website: '' });
  const [invalid, setInvalid] = useState(false);
  const signup = useMutation({ mutationFn: (body: object) => api<{ status: string }>('/signup', { method: 'POST', body }) });

  if (signup.isSuccess) {
    return (
      <PublicShell>
        <h1 className="text-2xl font-semibold">{t('signup.checkInbox')}</h1>
        <p className="text-sm text-slate-700">{t('signup.checkInboxHelp', { email: f.ownerEmail })}</p>
        <Link to="/" className="inline-block text-sm font-medium text-accent-700 hover:underline">
          {t('signup.backToLogin')}
        </Link>
      </PublicShell>
    );
  }

  return (
    <PublicShell wide>
      <div>
        <h1 className="text-2xl font-semibold">{t('signup.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('signup.subtitle')}</p>
      </div>
      <form
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = signupSchema.safeParse({ ...f, locale: lang });
          setInvalid(!parsed.success);
          if (parsed.success) signup.mutate(parsed.data);
        }}
      >
        <fieldset>
          <legend className="text-sm font-medium">{t('signup.plan')}</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {(plans.data ?? []).map((p) => (
              <label key={p.code} className={`cursor-pointer rounded-lg border p-3 text-sm ${f.plan === p.code ? 'border-accent-600 ring-2 ring-accent-200' : 'border-slate-300'}`}>
                <input type="radio" name="plan" className="sr-only" checked={f.plan === p.code} onChange={() => setF({ ...f, plan: p.code })} />
                <span className="block font-semibold">{lang === 'en' ? p.nameEn : p.nameFr}</span>
                <span className="tabular block text-base">{money(p.monthlyPrice, 'XAF')} <span className="text-xs text-slate-500">{t('signup.perMonth')}</span></span>
                <span className="mt-1 block text-xs text-slate-600">{t('signup.limits', { students: p.maxStudents, campuses: p.maxCampuses, users: p.maxUsers })}</span>
                <span className="mt-1 block text-xs text-slate-500">{lang === 'en' ? p.descriptionEn : p.descriptionFr}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-600">{t('signup.trial')}</p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium">{t('signup.schoolName')}</span>
            <input required className={field} value={f.schoolName} onChange={(e) => setF({ ...f, schoolName: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('signup.city')}</span>
            <input required className={field} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('signup.phone')}</span>
            <input type="tel" required autoComplete="tel" placeholder="+2376…" className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('signup.ownerName')}</span>
            <input required autoComplete="name" className={field} value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('auth.email')}</span>
            <input type="email" required autoComplete="email" className={field} value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium">{t('auth.password')}</span>
            <input type="password" required autoComplete="new-password" minLength={10} className={field} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <span className="mt-1 block text-xs text-slate-500">{t('account.passwordHint')}</span>
          </label>
          {/* Honeypot: hidden from people and assistive technology, filled only by bots. */}
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} />
          <span>{t('signup.terms')}</span>
        </label>

        {invalid && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger-600">
            {t('signup.invalid')}
          </p>
        )}
        <ErrorMessage error={signup.error} />
        <button type="submit" disabled={signup.isPending} className="w-full rounded-md bg-accent-600 px-4 py-2 font-medium text-white hover:bg-accent-700 disabled:opacity-60">
          {signup.isPending ? t('common.loading') : t('signup.submit')}
        </button>
        <p className="text-center text-sm">
          <Link to="/" className="text-accent-700 hover:underline">
            {t('signup.haveAccount')}
          </Link>
        </p>
      </form>
    </PublicShell>
  );
}

/** Opened from the e-mail link: confirms the address once, then points to sign-in. */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  // The link carries the token in the fragment, which browsers never send to servers (or their logs).
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? params.get('token') ?? '';
  const verify = useMutation({ mutationFn: () => api<{ verified: boolean }>('/signup/verify', { method: 'POST', body: { token } }) });
  const sent = useRef(false);
  useEffect(() => {
    // StrictMode runs effects twice in development; the link works only once.
    if (!sent.current && token) {
      sent.current = true;
      verify.mutate();
    }
  }, [token, verify]);

  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold">{t('signup.verifyTitle')}</h1>
      {verify.isPending || (!verify.isSuccess && !verify.isError && token) ? (
        <p className="text-slate-600">{t('common.loading')}</p>
      ) : verify.isSuccess ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-success-600">
          {t('signup.verified')}
        </p>
      ) : (
        <ErrorMessage error={verify.error ?? new Error('missing token')} />
      )}
      <Link to="/" className="inline-block font-medium text-accent-700 hover:underline">
        {t('signup.toLogin')}
      </Link>
    </PublicShell>
  );
}
