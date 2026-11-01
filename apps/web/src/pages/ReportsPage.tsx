import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, ErrorMessage, Field, Input, Loading, PageHeader, Table } from '../components/ui';
import { openBlob } from '../lib/api';
import type { Aging, FinanceSummary } from '../lib/finance-types';
import { useCurrentYear, useLabel, useSchoolToday, useTenantQuery } from '../lib/hooks';
import { useMoney } from '../lib/money';

/** Financial dashboard (Module 10) and aging (Module 13). Every figure carries its definition. */
export function ReportsPage() {
  const { t } = useTranslation();
  const label = useLabel();
  const money = useMoney();
  const today = useSchoolToday();
  const { current } = useCurrentYear();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exportError, setExportError] = useState<unknown>(null);
  const start = from || current?.startDate || today;
  const end = to || today;
  const summary = useTenantQuery<FinanceSummary>(['summary', start, end], `/finance/reports/summary?from=${start}&to=${end}`);
  const aging = useTenantQuery<Aging>(['aging', end], `/finance/reports/aging?asOf=${end}`);
  const s = summary.data;

  const kpi = (key: keyof FinanceSummary & string, value: string, emphasis = false) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4" title={t(`reports.definitionText.${key}`, { defaultValue: s?.definitions[key] ?? '' })}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{t(`reports.kpi.${key}`)}</p>
      <p className={`tabular mt-1 ${emphasis ? 'text-2xl font-semibold' : 'text-xl'}`}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('reports.financialTitle')}
        actions={<Button variant="secondary" onClick={() => openBlob(`/exports/payments.csv?from=${start}&to=${end}`).catch(setExportError)}>{t('reports.exportPayments')}</Button>}
      />
      <ErrorMessage error={exportError} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('reports.from')}>
          <Input type="date" value={start} max={end} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('reports.to')}>
          <Input type="date" value={end} max={today} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {s && (
          <span className="pb-2">
            <Badge tone={s.status === 'FINAL' ? 'green' : 'amber'}>{t(`reports.status.${s.status}`)}</Badge>
          </span>
        )}
      </div>

      {summary.isPending ? (
        <Loading />
      ) : summary.isError ? (
        <ErrorMessage error={summary.error} />
      ) : s ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kpi('billed', money(s.billed, s.currency))}
            {kpi('collected', money(s.collected, s.currency), true)}
            {kpi('outstanding', money(s.outstanding, s.currency))}
            {kpi('collectionRate', s.collectionRate === null ? '—' : `${s.collectionRate} %`, true)}
            {kpi('expenses', money(s.expenses, s.currency))}
            {kpi('refunds', money(s.refunds, s.currency))}
            {kpi('netCashResult', money(s.netCashResult, s.currency))}
            {kpi('operatingResult', money(s.operatingResult, s.currency))}
          </div>
          {s.pendingVerification.count > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('reports.pending', { count: s.pendingVerification.count, amount: money(s.pendingVerification.amount, s.currency) })}
            </p>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t('reports.byMethod')}>
              <Table head={[t('fees.method'), t('fees.amount')]}>
                {s.collectedByMethod.map((m) => (
                  <tr key={m.method}>
                    <td>{t(`fees.methods.${m.method}`)}</td>
                    <td className="tabular">{money(m.amount, s.currency)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title={t('reports.byCategory')}>
              <Table head={[t('expenses.category'), t('fees.amount')]}>
                {s.expensesByCategory.map((c) => (
                  <tr key={c.category.code}>
                    <td>{label(c.category)}</td>
                    <td className="tabular">{money(c.amount, s.currency)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        </>
      ) : null}

      <Card title={t('reports.aging', { date: end })}>
        {aging.isPending ? (
          <Loading />
        ) : aging.isError ? (
          <ErrorMessage error={aging.error} />
        ) : aging.data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-5">
              {(['notDue', 'd0_30', 'd31_60', 'd61_90', 'd90plus'] as const).map((b) => (
                <div key={b} className={`rounded-md p-3 ${b === 'notDue' ? 'bg-slate-50' : b === 'd90plus' ? 'bg-red-50' : 'bg-amber-50'}`}>
                  <p className="text-xs text-slate-600">{t(`reports.buckets.${b}`)}</p>
                  <p className="tabular font-semibold">{money(aging.data.buckets[b], aging.data.currency)}</p>
                </div>
              ))}
            </div>
            {aging.data.students.length > 0 && (
              <div className="mt-4">
                <Table head={[t('students.name'), t('students.matricule'), t('reports.overdue')]}>
                  {aging.data.students.map((st) => (
                    <tr key={st.id}>
                      <td>
                        {st.lastName} {st.firstName}
                      </td>
                      <td className="tabular">{st.matricule}</td>
                      <td className="tabular font-medium">{money(st.overdue, aging.data!.currency)}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </>
        ) : null}
      </Card>

      <AnnualComparison />

      {s && (
        <Card title={t('reports.definitions')}>
          <dl className="space-y-2 text-sm">
            {Object.entries(s.definitions).map(([k, v]) => (
              <div key={k}>
                <dt className="font-medium">{t(`reports.kpi.${k}`)}</dt>
                <dd className="text-slate-600">{t(`reports.definitionText.${k}`, { defaultValue: v })}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </div>
  );
}

/** Year-over-year view (Module 10 annual dashboard, REP-007). */
function AnnualComparison() {
  const { t } = useTranslation();
  const money = useMoney();
  const data = useTenantQuery<{
    years: { id: string; name: string; complete: boolean; enrolled: number; attendanceRate: number | null; passRate: number | null; currency?: string; billed?: string; collected?: string; expenses?: string; collectionRate?: number | null; operatingResult?: string }[];
    basis: string;
  }>(['annual-comparison'], '/reports/annual-comparison');
  if (data.isPending) return <Loading />;
  if (data.isError) return <ErrorMessage error={data.error} />;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v} %`);
  return (
    <Card title={t('reports.annual')}>
      <Table head={[t('common.academicYear'), t('reports.enrolled'), t('reports.attendanceRate'), t('reports.passRate'), t('reports.kpi.billed'), t('reports.kpi.collected'), t('reports.kpi.collectionRate'), t('reports.kpi.expenses'), t('reports.kpi.operatingResult')]}>
        {data.data.years.map((y) => (
          <tr key={y.id}>
            <td className="font-medium">
              {y.name} {!y.complete && <Badge tone="amber">{t('reports.ongoing')}</Badge>}
            </td>
            <td className="tabular">{y.enrolled}</td>
            <td className="tabular">{pct(y.attendanceRate)}</td>
            <td className="tabular">{pct(y.passRate)}</td>
            <td className="tabular">{y.currency ? money(y.billed, y.currency) : '—'}</td>
            <td className="tabular">{y.currency ? money(y.collected, y.currency) : '—'}</td>
            <td className="tabular">{pct(y.collectionRate)}</td>
            <td className="tabular">{y.currency ? money(y.expenses, y.currency) : '—'}</td>
            <td className="tabular">{y.currency ? money(y.operatingResult, y.currency) : '—'}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 text-xs text-slate-500">{t('reports.annualBasis')}</p>
    </Card>
  );
}
