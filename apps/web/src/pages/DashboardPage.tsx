import { useTranslation } from 'react-i18next';
import { useSession } from '../lib/session';

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { me, context } = useSession();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('dashboard.welcome', { name: me.user.fullName })}</h1>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('dashboard.roles')}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {context?.roles.map((r) => (
            <li key={r.key} className="rounded-full bg-accent-50 px-3 py-1 text-sm text-accent-700">
              {i18n.resolvedLanguage === 'en' ? r.nameEn : r.nameFr}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">{t('dashboard.foundation')}</h2>
        <p className="mt-2 text-slate-600">{t('dashboard.foundationText')}</p>
      </section>
    </div>
  );
}
