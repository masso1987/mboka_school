import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table, Tabs } from '../components/ui';
import type { BudgetReport, ExpenseRow, FinanceSettings } from '../lib/finance-types';
import { useCurrentYear, useDateFormat, useLabel, useSchoolToday, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useMoney } from '../lib/money';
import { useSession } from '../lib/session';

type Tab = 'expenses' | 'budget';
type Category = { id: string; code: string; nameFr: string; nameEn: string };

const tone = (s: string) => (s === 'PAID' ? 'green' : s === 'APPROVED' ? 'blue' : s === 'SUBMITTED' ? 'amber' : s === 'REJECTED' ? 'red' : 'slate');

export function ExpensesPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('expenses');
  const items: { key: Tab; label: string }[] = [{ key: 'expenses', label: t('expenses.tabs.expenses') }];
  if (can('reports.financial.read')) items.push({ key: 'budget', label: t('expenses.tabs.budget') });
  return (
    <div>
      <PageHeader title={t('nav.expenses')} />
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === 'expenses' ? <ExpensesTab /> : <BudgetTab />}
    </div>
  );
}

function ExpensesTab() {
  const { t } = useTranslation();
  const label = useLabel();
  const money = useMoney();
  const fmt = useDateFormat();
  const today = useSchoolToday();
  const { can } = useSession();
  const [status, setStatus] = useState('');
  const expenses = useTenantQuery<ExpenseRow[]>(['expenses', status], `/expenses${status ? `?status=${status}` : ''}`);
  const categories = useTenantQuery<Category[]>(['expense-categories'], '/expense-categories');
  const settings = useTenantQuery<FinanceSettings>(['finance-settings'], can('fees.invoice.read') ? '/finance/settings' : null);
  const empty = { categoryId: '', supplier: '', description: '', amount: '', currency: 'XAF', expenseDate: today };
  const [f, setF] = useState(empty);
  const create = useTenantMutation<object>('POST', '/expenses', [['expenses']]);
  const act = useTenantMutation<{ id: string; action: string; paymentReference?: string }, { budgetWarning: { budgeted: string; afterApproval: string } | null; currency: string }>(
    'POST',
    (b) => `/expenses/${b.id}/actions`,
    [['expenses'], ['budget']],
  );
  const canApprove = can('expenses.approve') || can('expenses.approve.unlimited');
  const reporting = settings.data?.reportingCurrency ?? 'XAF';

  return (
    <div className="space-y-6">
      {can('expenses.create') && (
        <Card title={t('expenses.new')}>
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ ...f, amount: f.amount.replace(/\s/g, ''), ...(f.supplier ? {} : { supplier: undefined }) }, { onSuccess: () => setF(empty) });
            }}
          >
            <Field label={t('expenses.category')}>
              <Select required value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
                <option value="" />
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {label(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('expenses.description')} className="sm:col-span-2">
              <Input required minLength={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <Field label={t('expenses.supplier')}>
              <Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
            </Field>
            <Field label={t('fees.amount')}>
              <Input required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </Field>
            <Field label={t('fees.currency')}>
              <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {(settings.data?.enabledCurrencies ?? ['XAF']).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('fees.date')}>
              <Input type="date" max={today} required value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} />
            </Field>
            <div className="space-y-2 sm:col-span-3">
              <ErrorMessage error={create.error} />
              <Button type="submit" disabled={create.isPending}>
                {t('expenses.submit')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {act.data?.budgetWarning && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('expenses.budgetWarning', { budgeted: money(act.data.budgetWarning.budgeted, reporting), after: money(act.data.budgetWarning.afterApproval, reporting) })}
        </p>
      )}
      <ErrorMessage error={act.error} />

      <Card>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="mb-4 max-w-xs" aria-label={t('common.status')}>
          <option value="">{t('expenses.allStatuses')}</option>
          {['SUBMITTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {t(`expenses.statuses.${s}`)}
            </option>
          ))}
        </Select>
        {expenses.isPending ? (
          <Loading />
        ) : expenses.isError ? (
          <ErrorMessage error={expenses.error} />
        ) : expenses.data.length === 0 ? (
          <Empty>{t('expenses.empty')}</Empty>
        ) : (
          <Table head={[t('expenses.number'), t('fees.date'), t('expenses.description'), t('fees.amount'), t('common.status'), '']}>
            {expenses.data.map((e) => (
              <tr key={e.id}>
                <td className="tabular">{e.number}</td>
                <td className="tabular">{fmt(e.expenseDate)}</td>
                <td>
                  <p>{e.description}</p>
                  <p className="text-xs text-slate-500">
                    {label(e.category)}
                    {e.supplier && ` · ${e.supplier}`}
                  </p>
                </td>
                <td className="tabular">{money(e.amount, e.currency)}</td>
                <td>
                  <Badge tone={tone(e.status)}>{t(`expenses.statuses.${e.status}`)}</Badge>
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    {e.status === 'SUBMITTED' && canApprove && !e.isMine && (
                      <>
                        <Button variant="ghost" onClick={() => act.mutate({ id: e.id, action: 'REJECT' })}>
                          {t('fees.reject')}
                        </Button>
                        <Button onClick={() => act.mutate({ id: e.id, action: 'APPROVE' })}>{t('fees.approve')}</Button>
                      </>
                    )}
                    {e.status === 'APPROVED' && canApprove && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const ref = window.prompt(t('expenses.paymentReference')) ?? undefined;
                          act.mutate({ id: e.id, action: 'PAY', ...(ref && { paymentReference: ref }) });
                        }}
                      >
                        {t('expenses.markPaid')}
                      </Button>
                    )}
                    {e.status === 'SUBMITTED' && e.isMine && (
                      <Button variant="ghost" onClick={() => window.confirm(t('expenses.cancelConfirm')) && act.mutate({ id: e.id, action: 'CANCEL' })}>
                        {t('common.cancel')}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function BudgetTab() {
  const { t } = useTranslation();
  const label = useLabel();
  const money = useMoney();
  const { can } = useSession();
  const { current } = useCurrentYear();
  const report = useTenantQuery<BudgetReport>(['budget', current?.id], current ? `/budgets/${current.id}` : null);
  const categories = useTenantQuery<Category[]>(['expense-categories'], '/expense-categories');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [cat, setCat] = useState({ code: '', nameFr: '', nameEn: '' });
  const save = useTenantMutation<object>('PUT', '/budgets', [['budget']]);
  const createCat = useTenantMutation<object>('POST', '/expense-categories', [['expense-categories']]);

  useEffect(() => {
    if (report.data) setAmounts(Object.fromEntries(report.data.lines.map((l) => [l.category.id, l.budgeted])));
  }, [report.data]);

  if (report.isPending || !current) return <Loading />;
  if (report.isError) return <ErrorMessage error={report.error} />;
  const r = report.data;
  const manage = can('budgets.manage');

  return (
    <div className="space-y-6">
      <Card title={`${t('expenses.budgetFor', { year: r.academicYear.name })} (${r.currency})`}>
        {r.lines.length === 0 && !manage ? (
          <Empty>{t('expenses.noBudget')}</Empty>
        ) : (
          <Table head={[t('expenses.category'), t('expenses.budgeted'), t('expenses.actual'), t('expenses.remaining'), t('expenses.utilization')]}>
            {r.lines.map((l) => (
              <tr key={l.category.id} className={l.overrun ? 'bg-red-50' : ''}>
                <td>{label(l.category)}</td>
                <td className="tabular">{money(l.budgeted, r.currency)}</td>
                <td className="tabular">{money(l.actual, r.currency)}</td>
                <td className={`tabular ${l.overrun ? 'font-semibold text-danger-600' : ''}`}>{money(l.remaining, r.currency)}</td>
                <td className="tabular">{l.utilization === null ? '—' : `${l.utilization} %`}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">{t('expenses.basis', { defaultValue: r.basis })}</p>
      </Card>
      {manage && (
        <Card title={t('expenses.editBudget')}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({
                academicYearId: current.id,
                name: r.budget?.name ?? `Budget ${r.academicYear.name}`,
                lines: Object.entries(amounts)
                  .filter(([, v]) => v !== '')
                  .map(([categoryId, amount]) => ({ categoryId, amount: amount.replace(/\s/g, '') })),
              });
            }}
          >
            {categories.data?.map((c) => (
              <Field key={c.id} label={label(c)} className="max-w-sm">
                <Input inputMode="decimal" value={amounts[c.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })} />
              </Field>
            ))}
            <ErrorMessage error={save.error} />
            <Button type="submit" disabled={save.isPending || (categories.data?.length ?? 0) === 0}>
              {t('common.save')}
            </Button>
          </form>
          <form
            className="mt-6 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              createCat.mutate(cat, { onSuccess: () => setCat({ code: '', nameFr: '', nameEn: '' }) });
            }}
          >
            <Field label={t('common.code')}>
              <Input required value={cat.code} onChange={(e) => setCat({ ...cat, code: e.target.value })} />
            </Field>
            <Field label={t('common.nameFr')}>
              <Input required value={cat.nameFr} onChange={(e) => setCat({ ...cat, nameFr: e.target.value })} />
            </Field>
            <Field label={t('common.nameEn')}>
              <Input required value={cat.nameEn} onChange={(e) => setCat({ ...cat, nameEn: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" disabled={createCat.isPending} className="w-full">
                {t('expenses.addCategory')}
              </Button>
            </div>
            <div className="sm:col-span-4">
              <ErrorMessage error={createCat.error} />
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
