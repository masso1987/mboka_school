import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorMessage, Input, Loading, PageHeader, Table } from '../components/ui';
import { api } from '../lib/api';
import { useDateFormat } from '../lib/hooks';
import { useMoney } from '../lib/money';
import type { PublicPlan } from './SignupPage';
import { stateTone } from './SubscriptionTab';

interface Row {
  tenant: { id: string; slug: string; legalName: string; status: string; createdAt: string };
  subscription: { plan: string; state: string; endsAt: string | null; usage: { students: number; users: number } };
  openInvoice: { id: string; number: string; amount: string; currency: string; plan: string; billingCycle: string } | null;
}

/** Platform administrators: schools, subscriptions, payments to confirm and the plan catalogue. No school data. */
export function PlatformPage() {
  const { t } = useTranslation();
  const money = useMoney();
  const fmt = useDateFormat();
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ['platform-subscriptions'], queryFn: () => api<Row[]>('/platform/subscriptions') });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api<(PublicPlan & { isPublic: boolean; sortOrder: number })[]>('/platform/plans') });
  const [refs, setRefs] = useState<Record<string, string>>({});
  const pay = useMutation({
    mutationFn: (r: Row) => api(`/platform/tenants/${r.tenant.id}/subscription-invoices/${r.openInvoice!.id}/pay`, { method: 'POST', body: { reference: refs[r.openInvoice!.id] ?? '' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-subscriptions'] }),
  });
  const savePlan = useMutation({
    mutationFn: (p: PublicPlan & { isPublic: boolean; sortOrder: number }) => {
      const { code, ...body } = p;
      return api(`/platform/plans/${code}`, { method: 'PUT', body: { ...body, descriptionFr: body.descriptionFr ?? undefined, descriptionEn: body.descriptionEn ?? undefined } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-plans'] }),
  });
  const [edits, setEdits] = useState<Record<string, { monthlyPrice: string; annualPrice: string }>>({});

  return (
    <div className="space-y-6">
      <PageHeader title={t('platform.title')} />
      <Card title={t('platform.schools')}>
        {rows.isPending ? (
          <Loading />
        ) : rows.isError ? (
          <ErrorMessage error={rows.error} />
        ) : (
          <Table head={[t('platform.school'), t('subscription.plan'), t('common.status'), t('platform.usage'), t('platform.toConfirm')]}>
            {rows.data.map((r) => (
              <tr key={r.tenant.id}>
                <td>
                  <p className="font-medium">{r.tenant.legalName}</p>
                  <p className="text-xs text-slate-500">
                    {r.tenant.slug} · {fmt(r.tenant.createdAt.slice(0, 10))}
                  </p>
                </td>
                <td>{r.subscription.plan}</td>
                <td>
                  <Badge tone={stateTone(r.subscription.state)}>{t(`subscription.states.${r.subscription.state}`)}</Badge>
                  {r.subscription.endsAt && <p className="text-xs text-slate-500">{fmt(r.subscription.endsAt.slice(0, 10))}</p>}
                </td>
                <td className="tabular text-sm">{t('platform.usageLine', { students: r.subscription.usage.students, users: r.subscription.usage.users })}</td>
                <td>
                  {r.openInvoice && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular text-sm">
                        {r.openInvoice.number} · {money(r.openInvoice.amount, r.openInvoice.currency)}
                      </span>
                      <Input
                        className="w-40"
                        placeholder={t('platform.reference')}
                        value={refs[r.openInvoice.id] ?? ''}
                        onChange={(e) => setRefs({ ...refs, [r.openInvoice!.id]: e.target.value })}
                      />
                      <Button disabled={pay.isPending || (refs[r.openInvoice.id] ?? '').trim().length < 3} onClick={() => pay.mutate(r)}>
                        {t('platform.confirmPayment')}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="mt-3">
          <ErrorMessage error={pay.error} />
        </div>
      </Card>

      <Card title={t('platform.plans')}>
        <p className="mb-3 text-sm text-slate-600">{t('platform.plansHelp')}</p>
        {plans.data && (
          <Table head={[t('subscription.plan'), t('subscription.cycles.MONTHLY'), t('subscription.cycles.ANNUAL'), t('platform.limits'), '']}>
            {plans.data.map((p) => {
              const e = edits[p.code] ?? { monthlyPrice: p.monthlyPrice, annualPrice: p.annualPrice };
              return (
                <tr key={p.code}>
                  <td className="font-medium">{p.nameFr}</td>
                  <td>
                    <Input className="tabular w-28" inputMode="numeric" value={e.monthlyPrice} onChange={(ev) => setEdits({ ...edits, [p.code]: { ...e, monthlyPrice: ev.target.value } })} />
                  </td>
                  <td>
                    <Input className="tabular w-32" inputMode="numeric" value={e.annualPrice} onChange={(ev) => setEdits({ ...edits, [p.code]: { ...e, annualPrice: ev.target.value } })} />
                  </td>
                  <td className="text-xs">{t('signup.limits', { students: p.maxStudents, campuses: p.maxCampuses, users: p.maxUsers })}</td>
                  <td>
                    <Button variant="ghost" disabled={savePlan.isPending} onClick={() => savePlan.mutate({ ...p, ...e })}>
                      {t('common.save')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        <div className="mt-3">
          <ErrorMessage error={savePlan.error} />
        </div>
      </Card>
    </div>
  );
}
