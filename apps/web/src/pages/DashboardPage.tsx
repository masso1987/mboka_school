import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { hhmmFromMinutes } from '@mboka/shared';
import { Card, ErrorMessage, Loading } from '../components/ui';
import { useTenantQuery } from '../lib/hooks';
import { useMoney } from '../lib/money';
import { useSession } from '../lib/session';

interface Dashboard {
  school?: { academicYear: string; enrolled: number; attendanceRate30d: number | null };
  approvals?: Partial<Record<'expenses' | 'refunds' | 'leave' | 'gradeSheets', number>>;
  cashDesk?: { collectedToday: string; paymentsToday: number; pendingVerification: number; openRegisters: number };
  teaching?: {
    lessonsToday: { start: number; end: number; subject: string; class: string; room: string | null }[];
    registersToTake: { classId: string; name: string }[];
    gradeSheetsInProgress: number;
  };
  finance?: { currency: string; billed: string; collected: string; outstanding: string; collectionRate: number | null; expenses: string; status: string };
  unreadNotifications: number;
}

const approvalLinks: Record<string, string> = { expenses: '/expenses', refunds: '/fees', leave: '/hr', gradeSheets: '/grades' };

/** One dashboard; each block appears only when the user's permissions allow it (spec §8.3). */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const { me, context, can } = useSession();
  const dash = useTenantQuery<Dashboard>(['dashboard'], '/dashboard');
  const portal = can('portal.parent') || can('portal.student');
  const children = useTenantQuery<{ id: string; firstName: string; lastName: string; class: { name: string } | null }[]>(['portal-children'], portal ? '/portal/children' : null);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-[1.65rem] font-bold leading-tight">{t('dashboard.welcome', { name: me.user.fullName })}</h1>
        {context && context.roles.length > 0 && (
          <p className="mt-1 text-sm text-slate-600">{context.roles.map((r) => (i18n.resolvedLanguage === 'en' ? r.nameEn : r.nameFr)).join(', ')}</p>
        )}
      </div>

      {dash.isPending ? (
        <Loading />
      ) : dash.isError ? (
        <ErrorMessage error={dash.error} />
      ) : (
        <>
          {portal && (
            <Card title={t('portal.children')}>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {children.data?.map((c) => (
                  <li key={c.id}>
                    <Link to={`/portal/children/${c.id}`} className="block rounded-md border border-slate-200 p-4 hover:border-accent-500 hover:bg-accent-50">
                      <span className="block font-medium">
                        {c.firstName} {c.lastName}
                      </span>
                      <span className="text-sm text-slate-600">{c.class?.name ?? '—'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(dash.data.school || dash.data.finance) && (
            <Figures>
              {dash.data.school && <Kpi label={t('dashboard.enrolled', { year: dash.data.school.academicYear })} value={String(dash.data.school.enrolled)} />}
              {dash.data.school && <Kpi label={t('dashboard.attendance30')} value={dash.data.school.attendanceRate30d === null ? '—' : `${dash.data.school.attendanceRate30d} %`} />}
              {dash.data.finance && <Kpi label={t('reports.kpi.collected')} value={money(dash.data.finance.collected, dash.data.finance.currency)} />}
              {dash.data.finance && <Kpi label={t('reports.kpi.collectionRate')} value={dash.data.finance.collectionRate === null ? '—' : `${dash.data.finance.collectionRate} %`} />}
              {dash.data.finance && <Kpi label={t('reports.kpi.outstanding')} value={money(dash.data.finance.outstanding, dash.data.finance.currency)} />}
              {dash.data.finance && <Kpi label={t('reports.kpi.expenses')} value={money(dash.data.finance.expenses, dash.data.finance.currency)} />}
            </Figures>
          )}

          {dash.data.approvals && (
            <Card title={t('dashboard.approvals')}>
              <ul className="-mx-2 grid sm:grid-cols-2">
                {Object.entries(dash.data.approvals).map(([k, n]) => (
                  <li key={k}>
                    <Link to={approvalLinks[k] ?? '/'} className="flex items-center justify-between rounded-md px-2 py-2.5 hover:bg-slate-50">
                      <span className={`text-sm ${n ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{t(`dashboard.pending.${k}`)}</span>
                      <span className={`tabular min-w-7 rounded px-1.5 text-center text-sm font-bold ${n ? 'bg-action-600 text-white' : 'text-slate-400'}`}>{n}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {dash.data.teaching && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title={t('dashboard.today')}>
                {dash.data.teaching.lessonsToday.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('dashboard.noLessons')}</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {dash.data.teaching.lessonsToday.map((l, i) => (
                      <li key={i} className="flex justify-between py-2">
                        <span>
                          <span className="font-medium">{l.subject}</span> — {l.class}
                        </span>
                        <span className="tabular text-slate-500">
                          {hhmmFromMinutes(l.start)}–{hhmmFromMinutes(l.end)}
                          {l.room && ` · ${l.room}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={t('dashboard.toDo')}>
                <ul className="space-y-2 text-sm">
                  {dash.data.teaching.registersToTake.map((r) => (
                    <li key={r.classId}>
                      <Link to="/attendance" className="text-accent-700 hover:underline">
                        {t('dashboard.takeRegister', { name: r.name })}
                      </Link>
                    </li>
                  ))}
                  {dash.data.teaching.gradeSheetsInProgress > 0 && (
                    <li>
                      <Link to="/grades" className="text-accent-700 hover:underline">
                        {t('dashboard.sheetsInProgress', { count: dash.data.teaching.gradeSheetsInProgress })}
                      </Link>
                    </li>
                  )}
                  {dash.data.teaching.registersToTake.length === 0 && dash.data.teaching.gradeSheetsInProgress === 0 && <li className="text-slate-500">{t('dashboard.allDone')}</li>}
                </ul>
              </Card>
            </div>
          )}

          {dash.data.cashDesk && (
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-base font-bold">{t('dashboard.cashDesk')}</h2>
                <Link to="/fees" className="text-sm font-semibold text-accent-700 hover:underline">
                  {t('nav.fees')}
                </Link>
              </div>
              <Figures>
                <Kpi label={t('dashboard.collectedToday')} value={money(dash.data.cashDesk.collectedToday, context?.tenant.defaultCurrency ?? 'XAF')} />
                <Kpi label={t('dashboard.paymentsToday')} value={String(dash.data.cashDesk.paymentsToday)} />
                <Kpi label={t('dashboard.pendingVerification')} value={String(dash.data.cashDesk.pendingVerification)} />
                <Kpi label={t('dashboard.openRegisters')} value={String(dash.data.cashDesk.openRegisters)} />
              </Figures>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Figures side by side in one panel, separated by hairlines. Each cell draws its right and bottom rule; the grid is
 * pulled one pixel under the panel's edge so the outer rules never double, and a half-filled last row stays white.
 */
function Figures({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-slate-200 bg-white">
      <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] [&>*]:border-b [&>*]:border-r [&>*]:border-slate-200">{children}</dl>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3 sm:px-4 sm:py-3.5">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="tabular mt-1 whitespace-nowrap text-base font-bold text-slate-900 sm:text-xl">{value}</dd>
    </div>
  );
}
