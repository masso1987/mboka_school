import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { ErrorMessage } from '../components/ui';
import { api } from '../lib/api';
import { PublicShell } from './SignupPage';

/** A published legal document (terms, privacy policy, legal notice), readable without an account. Plain text only. */
export function LegalPage() {
  const { t, i18n } = useTranslation();
  const { kind = 'terms' } = useParams();
  const [params] = useSearchParams();
  const locale = params.get('locale') ?? i18n.resolvedLanguage ?? 'fr';
  const doc = useQuery({
    queryKey: ['legal', kind, locale],
    queryFn: () => api<{ title: string; body: string; version: number; publishedAt: string }>(`/public/legal/${encodeURIComponent(kind)}?locale=${locale}`),
  });
  return (
    <PublicShell wide>
      {doc.isPending ? (
        <p className="text-slate-600">{t('common.loading')}</p>
      ) : doc.isError ? (
        <ErrorMessage error={doc.error} />
      ) : (
        <article>
          <h1 className="text-2xl font-semibold">{doc.data.title}</h1>
          <p className="mt-1 text-xs text-slate-500">{t('legal.version', { version: doc.data.version, date: new Date(doc.data.publishedAt).toLocaleDateString() })}</p>
          <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{doc.data.body}</div>
        </article>
      )}
      <Link to="/" className="inline-block font-medium text-accent-700 hover:underline">
        {t('signup.backToLogin')}
      </Link>
    </PublicShell>
  );
}
