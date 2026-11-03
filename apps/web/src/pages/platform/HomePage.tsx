import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, Empty, ErrorMessage, Loading, PageHeader, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useDateFormat } from '../../lib/hooks';
import { useMoney } from '../../lib/money';

interface Dashboard {
  schools: { total: number; active: number; suspended: number; closed: number };
  subscriptions: Record<string, number>;
  people: { students: number; users: number; members: number };
  activity: { sessionsNow: number; logins24h: number; failedLogins24h: number };
  revenueThisMonth: { currency: string; amount: string }[];
  alerts: { kind: string; tenantId?: string; school?: string; date?: string | null; count?: number }[];
  recentSchools: { id: string; slug: string; legalName: string; status: string; createdAt: string }[];
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Platform console home: the health of the whole service at a glance, refreshed every minute. */
export function PlatformHomePage() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const money = useMoney();
  const d = useQuery({ queryKey: ['platform-dashboard'], queryFn: () => api<Dashboard>('/platform/dashboard'), refetchInterval: 60_000 });

  if (d.isPending) return <Loading />;
  if (d.isError) return <ErrorMessage error={d.error} />;
  const x = d.data;
  const subs = x.subscriptions;

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platformHome')} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label={t('platform.kpi.schools')} value={x.schools.total} sub={t('platform.kpi.schoolsSub', { active: x.schools.active, suspended: x.schools.suspended })} />
        <Stat label={t('platform.kpi.trials')} value={subs.TRIAL ?? 0} sub={t('platform.kpi.trialsSub', { ok: subs.OK ?? 0, late: (subs.GRACE ?? 0) + (subs.EXPIRED ?? 0) })} />
        <Stat label={t('platform.kpi.students')} value={x.people.students} />
        <Stat label={t('platform.kpi.users')} value={x.people.users} sub={t('platform.kpi.usersSub', { members: x.people.members })} />
        <Stat label={t('platform.kpi.sessions')} value={x.activity.sessionsNow} sub={t('platform.kpi.loginsSub', { logins: x.activity.logins24h, failed: x.activity.failedLogins24h })} />
        <Stat
          label={t('platform.kpi.revenue')}
          value={x.revenueThisMonth.length === 0 ? '0' : x.revenueThisMonth.map((r) => money(r.amount, r.currency)).join(' · ')}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('platform.alerts')}>
          {x.alerts.length === 0 ? (
            <Empty>{t('platform.noAlerts')}</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {x.alerts.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    {t(`platform.alert.${a.kind}`, { school: a.school ?? '', count: a.count ?? 0, date: a.date ? fmt(a.date.slice(0, 10)) : '' })}
                  </span>
                  {a.tenantId && (
                    <Link to={`/platform/schools/${a.tenantId}`} className="shrink-0 text-accent-700 hover:underline">
                      {t('platform.open')}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('platform.recentSchools')}>
          {x.recentSchools.length === 0 ? (
            <Empty>{t('platform.noSchools')}</Empty>
          ) : (
            <Table head={[t('platform.school'), t('platform.created')]}>
              {x.recentSchools.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/platform/schools/${s.id}`} className="font-medium text-accent-700 hover:underline">
                      {s.legalName}
                    </Link>
                  </td>
                  <td className="tabular text-sm">{fmt(s.createdAt.slice(0, 10))}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
