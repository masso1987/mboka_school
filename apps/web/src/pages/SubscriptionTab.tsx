import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, ErrorMessage, Loading, Table } from '../components/ui';
import { useDateFormat, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useMoney } from '../lib/money';
import { useSession } from '../lib/session';
import type { PublicPlan } from './SignupPage';

interface Overview {
  subscription: {
    plan: string;
    status: string;
    billingCycle: string;
    state: 'OK' | 'TRIAL' | 'GRACE' | 'EXPIRED';
    endsAt: string | null;
    daysLeft: number | null;
    limits: { students: number; campuses: number; users: number };
    usage: { students: number; campuses: number; users: number };
  };
  plans: PublicPlan[];
  invoices: { id: string; number: string; plan: string; billingCycle: string; periodStart: string; periodEnd: string; amount: string; currency: string; status: 'OPEN' | 'PAID' | 'VOID'; paidAt: string | null }[];
  paymentInstructions: string | null;
}

export const stateTone = (s: string) => (s === 'OK' ? 'green' : s === 'TRIAL' ? 'blue' : s === 'GRACE' ? 'amber' : 'red');

/** The school's plan, usage and invoices; choosing a plan issues the invoice to pay. */
export function SubscriptionTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const fmt = useDateFormat();
  const { can } = useSession();
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const o = useTenantQuery<Overview>(['subscription'], '/subscription');
  const [cycle, setCycle] = useState<'MONTHLY' | 'ANNUAL'>('ANNUAL');
  const checkout = useTenantMutation<{ plan: string; cycle: string }>('POST', '/subscription/checkout', [['subscription'], ['tenant-context']]);

  if (o.isPending) return <Loading />;
  if (o.isError) return <ErrorMessage error={o.error} />;
  const { subscription: s, plans, invoices, paymentInstructions } = o.data;
  const open = invoices.find((i) => i.status === 'OPEN');
  const planName = (code: string) => {
    const p = plans.find((x) => x.code === code);
    return p ? (lang === 'en' ? p.nameEn : p.nameFr) : code;
  };

  return (
    <div className="space-y-6">
      <Card title={t('subscription.current')}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold">{planName(s.plan)}</span>
          <Badge tone={stateTone(s.state)}>{t(`subscription.states.${s.state}`)}</Badge>
          {s.endsAt && <span className="text-sm text-slate-600">{t('subscription.until', { date: fmt(s.endsAt.slice(0, 10)), days: s.daysLeft ?? 0 })}</span>}
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {(['students', 'campuses', 'users'] as const).map((k) => (
            <div key={k} className="rounded-md border border-slate-200 p-3">
              <dt className="text-xs text-slate-500">{t(`subscription.usage.${k}`)}</dt>
              <dd className="tabular text-lg font-semibold">
                {s.usage[k]} / {s.limits[k]}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      {open && (
        <Card title={t('subscription.toPay')}>
          <p className="text-sm">
            {t('subscription.invoiceLine', { number: open.number, plan: planName(open.plan), from: fmt(open.periodStart), to: fmt(open.periodEnd) })}
          </p>
          <p className="tabular mt-2 text-2xl font-semibold">{money(open.amount, open.currency)}</p>
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{t('subscription.howToPay', { reference: open.number })}</p>
            {paymentInstructions && <p className="mt-1 whitespace-pre-line">{paymentInstructions}</p>}
          </div>
        </Card>
      )}

      {can('tenant.settings.update') && (
        <Card
          title={t('subscription.choose')}
          actions={
            <div className="flex rounded-md border border-slate-300 text-sm">
              {(['MONTHLY', 'ANNUAL'] as const).map((c) => (
                <button key={c} type="button" onClick={() => setCycle(c)} className={`px-3 py-1 ${cycle === c ? 'bg-accent-600 text-white' : ''}`}>
                  {t(`subscription.cycles.${c}`)}
                </button>
              ))}
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {plans.map((p) => (
              <div key={p.code} className={`rounded-lg border p-4 ${p.code === s.plan ? 'border-accent-600' : 'border-slate-200'}`}>
                <p className="font-semibold">{lang === 'en' ? p.nameEn : p.nameFr}</p>
                <p className="tabular text-lg">{money(cycle === 'ANNUAL' ? p.annualPrice : p.monthlyPrice, 'XAF')}</p>
                <p className="text-xs text-slate-600">{t('signup.limits', { students: p.maxStudents, campuses: p.maxCampuses, users: p.maxUsers })}</p>
                <Button className="mt-3 w-full" disabled={checkout.isPending} onClick={() => checkout.mutate({ plan: p.code, cycle })}>
                  {t('subscription.select')}
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <ErrorMessage error={checkout.error} />
          </div>
        </Card>
      )}

      <Card title={t('subscription.invoices')}>
        <Table head={[t('subscription.number'), t('subscription.plan'), t('subscription.period'), t('subscription.amount'), t('common.status')]}>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td className="font-medium">{i.number}</td>
              <td>
                {planName(i.plan)} · {t(`subscription.cycles.${i.billingCycle}`)}
              </td>
              <td className="text-sm">
                {fmt(i.periodStart)} → {fmt(i.periodEnd)}
              </td>
              <td className="tabular">{money(i.amount, i.currency)}</td>
              <td>
                <Badge tone={i.status === 'PAID' ? 'green' : i.status === 'OPEN' ? 'amber' : 'slate'}>{t(`subscription.invoiceStatuses.${i.status}`)}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
