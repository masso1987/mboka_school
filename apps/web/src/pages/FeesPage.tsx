import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { DISCOUNT_KINDS, PAYMENT_METHODS } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table, Tabs } from '../components/ui';
import type { CashierSession, FeeSchedule, FinanceSettings, InvoiceDetail, InvoiceRow, PaymentView, RefundRow, Statement } from '../lib/finance-types';
import { useCurrentYear, useDateFormat, useLabel, useSchoolToday, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { newKey, useMoney } from '../lib/money';
import { useSession } from '../lib/session';
import type { EducationLevel, Page, StudentRow } from '../lib/types';

type Tab = 'desk' | 'invoices' | 'schedules' | 'refunds' | 'settings';

const payTone = (s: string) => (s === 'PAID' || s === 'CONFIRMED' ? 'green' : s === 'PARTIALLY_PAID' || s === 'PENDING_VERIFICATION' ? 'amber' : s === 'UNPAID' ? 'red' : 'slate');

export function FeesPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>(can('payments.record') ? 'desk' : 'invoices');
  const items: { key: Tab; label: string }[] = [];
  if (can('payments.record')) items.push({ key: 'desk', label: t('fees.tabs.desk') });
  items.push({ key: 'invoices', label: t('fees.tabs.invoices') });
  items.push({ key: 'schedules', label: t('fees.tabs.schedules') });
  items.push({ key: 'refunds', label: t('fees.tabs.refunds') });
  if (can('finance.settings.manage')) items.push({ key: 'settings', label: t('fees.tabs.settings') });
  return (
    <div>
      <PageHeader title={t('nav.fees')} />
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === 'desk' && <PaymentDesk />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'schedules' && <SchedulesTab />}
      {tab === 'refunds' && <RefundsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

// ---------------------------------------------------------------- payment desk

function PaymentDesk() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [studentId, setStudentId] = useState<string>();
  const students = useTenantQuery<Page<StudentRow>>(['students', q, 1], q.length >= 2 ? `/students?pageSize=8&q=${encodeURIComponent(q)}` : null);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title={t('fees.findStudent')}>
          <Input type="search" placeholder={t('students.search')} aria-label={t('students.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          {q.length >= 2 && (
            <ul className="mt-3 divide-y divide-slate-100">
              {students.data?.items.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setStudentId(s.id);
                      setQ('');
                    }}
                    className="flex w-full items-center justify-between px-1 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium">
                      {s.lastName} {s.firstName}
                    </span>
                    <span className="tabular text-slate-500">
                      {s.matricule} · {s.currentClass?.name ?? '—'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {studentId && <StudentAccount studentId={studentId} />}
      </div>
      <CashRegister />
    </div>
  );
}

function StudentAccount({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const money = useMoney();
  const fmt = useDateFormat();
  const statement = useTenantQuery<Statement>(['statement', studentId], `/students/${studentId}/statement`);
  if (statement.isPending) return <Loading />;
  if (statement.isError) return <ErrorMessage error={statement.error} />;
  const s = statement.data;
  return (
    <>
      <Card title={`${s.student.lastName} ${s.student.firstName} — ${s.student.matricule}`}>
        <div className="mb-4 flex flex-wrap gap-3">
          {s.balances.length === 0 ? (
            <p className="text-sm text-slate-500">{t('fees.noInvoices')}</p>
          ) : (
            s.balances.map((b) => (
              <div key={b.currency} className="rounded-md bg-slate-50 px-4 py-2">
                <p className="text-xs text-slate-500">{t('fees.balanceDue')}</p>
                <p className="tabular text-xl font-semibold">{money(b.balance, b.currency)}</p>
                <p className="tabular text-xs text-slate-500">
                  {t('fees.paidOf', { paid: money(b.paid, b.currency), total: money(b.total, b.currency) })}
                </p>
              </div>
            ))
          )}
        </div>
        {s.invoices.length > 0 && (
          <Table head={[t('fees.invoice'), t('fees.issued'), t('fees.total'), t('fees.balance'), t('common.status')]}>
            {s.invoices.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link to={`/fees/invoices/${i.id}`} className="tabular text-accent-700 hover:underline">
                    {i.number}
                  </Link>
                </td>
                <td className="tabular">{fmt(i.issueDate)}</td>
                <td className="tabular">{money(i.total, i.currency)}</td>
                <td className="tabular font-medium">{money(i.balance, i.currency)}</td>
                <td>
                  <Badge tone={payTone(i.paymentStatus)}>{t(`fees.paymentStatuses.${i.paymentStatus}`)}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <RecordPayment studentId={studentId} />
      {s.payments.length > 0 && (
        <Card title={t('fees.paymentHistory')}>
          <Table head={[t('fees.date'), t('fees.method'), t('fees.amount'), t('fees.receipt'), t('common.status')]}>
            {s.payments.map((p) => (
              <tr key={p.id}>
                <td className="tabular">{fmt(p.receivedOn)}</td>
                <td>{t(`fees.methods.${p.method}`)}</td>
                <td className="tabular">
                  {money(p.amount, p.currency)}
                  {p.credit !== '0' && Number(p.credit) > 0 && <span className="block text-xs text-amber-700">{t('fees.credit', { amount: money(p.credit, p.currency) })}</span>}
                </td>
                <td>
                  {p.receipt ? (
                    <Link to={`/fees/receipts/${p.id}`} className="tabular text-accent-700 hover:underline">
                      {p.receipt}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <Badge tone={payTone(p.status)}>{t(`fees.paymentStatuses.${p.status}`)}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

function RecordPayment({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const money = useMoney();
  const today = useSchoolToday();
  const settings = useTenantQuery<FinanceSettings>(['finance-settings'], '/finance/settings');
  const providers = settings.data?.providers ?? [];
  const currencies = settings.data?.enabledCurrencies ?? ['XAF'];
  const empty = { method: 'CASH', currency: currencies[0] ?? 'XAF', amount: '', externalReference: '', receivedOn: today, provider: '' };
  const [f, setF] = useState(empty);
  // One key per payment attempt: retries after a network error reuse it, so nothing is recorded twice.
  const [key, setKey] = useState(newKey);
  const record = useTenantMutation<object, PaymentView>('POST', '/payments', [['statement', studentId], ['cashier'], ['invoices']]);
  const result = record.data;

  return (
    <Card title={t('fees.recordPayment')}>
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          record.mutate(
            {
              idempotencyKey: key,
              studentId,
              method: f.method,
              currency: f.currency,
              amount: f.amount.replace(/\s/g, '').replace(',', '.'),
              receivedOn: f.receivedOn,
              ...(f.externalReference && { externalReference: f.externalReference }),
              ...(f.provider && { provider: f.provider }),
            },
            {
              onSuccess: () => {
                setF({ ...empty, currency: f.currency, method: f.method });
                setKey(newKey());
              },
            },
          );
        }}
      >
        <Field label={t('fees.method')}>
          <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`fees.methods.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('fees.currency')}>
          <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('fees.amount')}>
          <Input required inputMode="decimal" autoComplete="off" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="tabular" />
        </Field>
        {f.method !== 'CASH' && (
          <Field label={t('fees.reference')} hint={f.method === 'MOBILE_MONEY' ? t('fees.referenceHintMomo') : undefined}>
            <Input value={f.externalReference} required={!f.provider} onChange={(e) => setF({ ...f, externalReference: e.target.value })} />
          </Field>
        )}
        {f.method === 'MOBILE_MONEY' && providers.length > 0 && (
          <Field label={t('fees.provider')}>
            <Select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
              <option value="">{t('fees.manualConfirmation')}</option>
              {providers.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('fees.date')}>
          <Input type="date" max={today} required value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} />
        </Field>
        <div className="space-y-3 sm:col-span-3">
          <ErrorMessage error={record.error} />
          <Button type="submit" disabled={record.isPending || !f.amount}>
            {record.isPending ? t('common.loading') : t('fees.recordPayment')}
          </Button>
        </div>
      </form>
      {result && (
        <div role="status" className="mt-4 rounded-md border border-green-200 bg-green-50 p-4 text-sm">
          {result.status === 'CONFIRMED' ? (
            <>
              <p className="font-medium text-success-600">{t('fees.recorded', { amount: money(result.amount, result.currency), receipt: result.receipt })}</p>
              <ul className="mt-2 space-y-1 text-slate-700">
                {result.allocations.map((al) => (
                  <li key={al.invoiceId} className="tabular">
                    {al.invoiceNumber}: {money(al.invoiceAmount, al.invoiceCurrency)}
                    {al.invoiceCurrency !== result.currency && <span className="text-slate-500"> (1 {result.currency} = {al.rate} {al.invoiceCurrency})</span>}
                  </li>
                ))}
                {Number(result.credit) > 0 && <li className="text-amber-700">{t('fees.credit', { amount: money(result.credit, result.currency) })}</li>}
              </ul>
              <Link to={`/fees/receipts/${result.id}`} className="mt-3 inline-block font-medium text-accent-700 hover:underline">
                {t('fees.printReceipt')}
              </Link>
            </>
          ) : (
            <p className="text-amber-800">{t('fees.pendingVerification')}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function CashRegister() {
  const { t } = useTranslation();
  const money = useMoney();
  const sessions = useTenantQuery<CashierSession[]>(['cashier'], '/cashier-sessions/mine');
  const settings = useTenantQuery<FinanceSettings>(['finance-settings'], '/finance/settings');
  const [open, setOpen] = useState({ currency: 'XAF', openingFloat: '0' });
  const [counted, setCounted] = useState('');
  const openM = useTenantMutation<object>('POST', '/cashier-sessions', [['cashier']]);
  const closeM = useTenantMutation<{ id: string; countedAmount: string }, CashierSession>('POST', (b) => `/cashier-sessions/${b.id}/close`, [['cashier']]);
  const closed = closeM.data;

  return (
    <Card title={t('fees.cashRegister')}>
      {sessions.isPending ? (
        <Loading />
      ) : (sessions.data?.length ?? 0) > 0 ? (
        sessions.data!.map((s) => (
          <div key={s.id} className="space-y-3 text-sm">
            <Badge tone="green">{t('fees.registerOpen', { currency: s.currency })}</Badge>
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-slate-500">{t('fees.openingFloat')}</dt>
              <dd className="tabular text-right">{money(s.openingFloat, s.currency)}</dd>
              <dt className="text-slate-500">{t('fees.cashTaken')}</dt>
              <dd className="tabular text-right">{money(s.cashTaken, s.currency)}</dd>
              <dt className="font-medium">{t('fees.expected')}</dt>
              <dd className="tabular text-right font-medium">{money(s.expectedAmount, s.currency)}</dd>
            </dl>
            <form
              className="space-y-2 border-t border-slate-100 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (window.confirm(t('fees.closeConfirm'))) closeM.mutate({ id: s.id, countedAmount: counted.replace(/\s/g, '') });
              }}
            >
              <Field label={t('fees.countedCash')}>
                <Input required inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} className="tabular" />
              </Field>
              <ErrorMessage error={closeM.error} />
              <Button type="submit" variant="secondary" disabled={closeM.isPending}>
                {t('fees.closeRegister')}
              </Button>
            </form>
          </div>
        ))
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            openM.mutate(open);
          }}
        >
          <p className="text-sm text-slate-600">{t('fees.registerClosedHelp')}</p>
          {closed && (
            <p role="status" className={`rounded-md px-3 py-2 text-sm ${closed.discrepancy === '0' || Number(closed.discrepancy) === 0 ? 'bg-green-50 text-success-600' : 'bg-amber-50 text-amber-800'}`}>
              {t('fees.closedSummary', {
                expected: money(closed.expectedAmount, closed.currency),
                counted: money(closed.countedAmount, closed.currency),
                gap: money(closed.discrepancy, closed.currency),
              })}
            </p>
          )}
          <Field label={t('fees.currency')}>
            <Select value={open.currency} onChange={(e) => setOpen({ ...open, currency: e.target.value })}>
              {(settings.data?.enabledCurrencies ?? ['XAF']).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('fees.openingFloat')}>
            <Input required inputMode="decimal" value={open.openingFloat} onChange={(e) => setOpen({ ...open, openingFloat: e.target.value })} className="tabular" />
          </Field>
          <ErrorMessage error={openM.error} />
          <Button type="submit" disabled={openM.isPending}>
            {t('fees.openRegister')}
          </Button>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- invoices

function InvoicesTab() {
  const { t } = useTranslation();
  const money = useMoney();
  const fmt = useDateFormat();
  const [q, setQ] = useState('');
  const [outstanding, setOutstanding] = useState(true);
  const invoices = useTenantQuery<InvoiceRow[]>(
    ['invoices', q, outstanding],
    `/invoices?outstanding=${outstanding}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Input type="search" placeholder={t('fees.searchInvoices')} aria-label={t('fees.searchInvoices')} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={outstanding} onChange={(e) => setOutstanding(e.target.checked)} />
          {t('fees.outstandingOnly')}
        </label>
      </div>
      {invoices.isPending ? (
        <Loading />
      ) : invoices.isError ? (
        <ErrorMessage error={invoices.error} />
      ) : invoices.data.length === 0 ? (
        <Empty>{t('fees.noInvoices')}</Empty>
      ) : (
        <Table head={[t('fees.invoice'), t('students.name'), t('fees.issued'), t('fees.total'), t('fees.balance'), t('common.status')]}>
          {invoices.data.map((i) => (
            <tr key={i.id}>
              <td>
                <Link to={`/fees/invoices/${i.id}`} className="tabular text-accent-700 hover:underline">
                  {i.number}
                </Link>
              </td>
              <td>
                {i.student?.lastName} {i.student?.firstName}
              </td>
              <td className="tabular">{fmt(i.issueDate)}</td>
              <td className="tabular">{money(i.total, i.currency)}</td>
              <td className="tabular font-medium">{money(i.balance, i.currency)}</td>
              <td>
                <Badge tone={payTone(i.paymentStatus)}>{t(`fees.paymentStatuses.${i.paymentStatus}`)}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const money = useMoney();
  const fmt = useDateFormat();
  const { can } = useSession();
  const inv = useTenantQuery<InvoiceDetail>(['invoice', id], `/invoices/${id}`);
  const [d, setD] = useState({ kind: 'SCHOLARSHIP', amount: '', reason: '' });
  const discount = useTenantMutation<object>('POST', `/invoices/${id}/discounts`, [['invoice', id], ['invoices']]);

  if (inv.isPending) return <Loading />;
  if (inv.isError) return <ErrorMessage error={inv.error} />;
  const i = inv.data;
  return (
    <div className="space-y-6">
      <PageHeader title={`${t('fees.invoice')} ${i.number}`} actions={<Link to="/fees" className="text-sm text-accent-700 hover:underline">← {t('nav.fees')}</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={i.student ? `${i.student.lastName} ${i.student.firstName}` : ''}>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">{t('fees.total')}</dt>
            <dd className="tabular text-right">{money(i.total, i.currency)}</dd>
            <dt className="text-slate-500">{t('fees.paid')}</dt>
            <dd className="tabular text-right">{money(i.paid, i.currency)}</dd>
            <dt className="font-medium">{t('fees.balance')}</dt>
            <dd className="tabular text-right font-semibold">{money(i.balance, i.currency)}</dd>
          </dl>
          <div className="mt-3">
            <Badge tone={payTone(i.paymentStatus)}>{t(`fees.paymentStatuses.${i.paymentStatus}`)}</Badge>
          </div>
        </Card>
        <div className="lg:col-span-2">
          <Card title={t('fees.lines')}>
            <Table head={[t('fees.description'), t('fees.dueDate'), t('fees.amount')]}>
              {i.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.kind === 'DISCOUNT' && <Badge tone="blue">{t(`fees.discountKinds.${l.discountKind}`)}</Badge>} {l.description}
                  </td>
                  <td className="tabular">{fmt(l.dueDate)}</td>
                  <td className="tabular">{l.kind === 'DISCOUNT' ? '−' : ''}{money(l.amount, i.currency)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
      <Card title={t('fees.paymentHistory')}>
        {i.payments.length === 0 ? (
          <Empty>{t('fees.noPayments')}</Empty>
        ) : (
          <Table head={[t('fees.date'), t('fees.method'), t('fees.amount'), t('fees.applied'), t('fees.receipt'), t('common.status')]}>
            {i.payments.map((p) => (
              <tr key={p.paymentId}>
                <td className="tabular">{fmt(p.receivedOn)}</td>
                <td>{t(`fees.methods.${p.method}`)}</td>
                <td className="tabular">{money(p.amount, p.paymentCurrency)}</td>
                <td className="tabular">{money(p.invoiceAmount, i.currency)}</td>
                <td>{p.receipt ? <Link to={`/fees/receipts/${p.paymentId}`} className="tabular text-accent-700 hover:underline">{p.receipt}</Link> : '—'}</td>
                <td>
                  <Badge tone={payTone(p.status)}>{t(`fees.paymentStatuses.${p.status}`)}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {can('fees.adjust') && i.status === 'ISSUED' && Number(i.balance) > 0 && (
        <Card title={t('fees.grantReduction')}>
          <form
            className="grid gap-4 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              discount.mutate({ ...d, amount: d.amount.replace(/\s/g, '') }, { onSuccess: () => setD({ ...d, amount: '', reason: '' }) });
            }}
          >
            <Field label={t('fees.reductionKind')}>
              <Select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>
                {DISCOUNT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`fees.discountKinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`${t('fees.amount')} (${i.currency})`}>
              <Input required inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} />
            </Field>
            <Field label={t('common.reason')} className="sm:col-span-2">
              <Input required minLength={3} value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} />
            </Field>
            <div className="space-y-2 sm:col-span-4">
              <ErrorMessage error={discount.error} />
              <Button type="submit" disabled={discount.isPending}>
                {t('fees.grant')}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- schedules

function SchedulesTab() {
  const { t } = useTranslation();
  const label = useLabel();
  const money = useMoney();
  const fmt = useDateFormat();
  const today = useSchoolToday();
  const { can } = useSession();
  const { current } = useCurrentYear();
  const schedules = useTenantQuery<FeeSchedule[]>(['schedules', current?.id], current ? `/fee-schedules?academicYearId=${current.id}` : null);
  const categories = useTenantQuery<{ id: string; code: string; nameFr: string; nameEn: string }[]>(['fee-categories'], '/fee-categories');
  const levels = useTenantQuery<EducationLevel[]>(['levels'], '/education-levels');
  const settings = useTenantQuery<FinanceSettings>(['finance-settings'], '/finance/settings');
  const [f, setF] = useState({ name: '', categoryId: '', levelId: '', currency: 'XAF', installments: [{ label: '', dueDate: '', amount: '' }] });
  const [cat, setCat] = useState({ code: '', nameFr: '', nameEn: '', kind: 'TUITION' });
  const create = useTenantMutation<object>('POST', '/fee-schedules', [['schedules']]);
  const createCat = useTenantMutation<object>('POST', '/fee-categories', [['fee-categories']]);
  const apply = useTenantMutation<{ id: string; issueDate: string }, { invoicesCreated: number; alreadyBilled: number }>(
    'POST',
    (b) => `/fee-schedules/${b.id}/apply`,
    [['schedules'], ['invoices']],
  );
  const manage = can('fees.invoice.create');

  return (
    <div className="space-y-6">
      {apply.data && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-success-600">
          {t('fees.appliedResult', { created: apply.data.invoicesCreated, existing: apply.data.alreadyBilled })}
        </p>
      )}
      <ErrorMessage error={apply.error} />
      <Card>
        {schedules.isPending ? (
          <Loading />
        ) : schedules.data?.length === 0 ? (
          <Empty>{t('fees.noSchedules')}</Empty>
        ) : (
          <Table head={[t('common.name'), t('fees.category'), t('fees.installments'), t('fees.total'), t('fees.billed'), '']}>
            {schedules.data?.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.name}</td>
                <td>{label(s.category)}</td>
                <td className="text-xs">
                  {s.installments.map((i) => (
                    <span key={i.label} className="tabular block">
                      {i.label} — {fmt(i.dueDate)} — {money(i.amount, s.currency)}
                    </span>
                  ))}
                </td>
                <td className="tabular">{money(s.amount, s.currency)}</td>
                <td className="tabular">{s.billedCount}</td>
                <td className="text-right">
                  {manage && (
                    <Button variant="secondary" disabled={apply.isPending} onClick={() => window.confirm(t('fees.applyConfirm')) && apply.mutate({ id: s.id, issueDate: today })}>
                      {t('fees.apply')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {manage && current && (
        <Card title={t('fees.newSchedule')}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(
                {
                  academicYearId: current.id,
                  categoryId: f.categoryId,
                  name: f.name,
                  currency: f.currency,
                  ...(f.levelId && { levelId: f.levelId }),
                  installments: f.installments.map((i) => ({ ...i, amount: i.amount.replace(/\s/g, '') })),
                },
                { onSuccess: () => setF({ ...f, name: '', installments: [{ label: '', dueDate: '', amount: '' }] }) },
              );
            }}
          >
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label={t('common.name')}>
                <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
              <Field label={t('fees.category')}>
                <Select required value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
                  <option value="" />
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {label(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('classes.level')}>
                <Select value={f.levelId} onChange={(e) => setF({ ...f, levelId: e.target.value })}>
                  <option value="">{t('fees.allLevels')}</option>
                  {levels.data?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {label(l)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('fees.currency')}>
                <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                  {(settings.data?.enabledCurrencies ?? ['XAF']).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            </div>
            {f.installments.map((inst, n) => (
              <div key={n} className="grid gap-4 sm:grid-cols-4">
                <Field label={`${t('fees.installment')} ${n + 1}`}>
                  <Input required value={inst.label} onChange={(e) => setF({ ...f, installments: f.installments.map((x, m) => (m === n ? { ...x, label: e.target.value } : x)) })} />
                </Field>
                <Field label={t('fees.dueDate')}>
                  <Input type="date" required value={inst.dueDate} onChange={(e) => setF({ ...f, installments: f.installments.map((x, m) => (m === n ? { ...x, dueDate: e.target.value } : x)) })} />
                </Field>
                <Field label={t('fees.amount')}>
                  <Input required inputMode="decimal" value={inst.amount} onChange={(e) => setF({ ...f, installments: f.installments.map((x, m) => (m === n ? { ...x, amount: e.target.value } : x)) })} />
                </Field>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setF({ ...f, installments: [...f.installments, { label: '', dueDate: '', amount: '' }] })} disabled={f.installments.length >= 12}>
                {t('fees.addInstallment')}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {t('common.save')}
              </Button>
            </div>
            <ErrorMessage error={create.error} />
          </form>
        </Card>
      )}
      {manage && (
        <Card title={t('fees.newCategory')}>
          <form
            className="grid gap-4 sm:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              createCat.mutate(cat, { onSuccess: () => setCat({ ...cat, code: '', nameFr: '', nameEn: '' }) });
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
            <Field label={t('fees.kind')}>
              <Select value={cat.kind} onChange={(e) => setCat({ ...cat, kind: e.target.value })}>
                {['REGISTRATION', 'TUITION', 'EXAM', 'TRANSPORT', 'CANTEEN', 'UNIFORM', 'OTHER'].map((k) => (
                  <option key={k} value={k}>
                    {t(`fees.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={createCat.isPending} className="w-full">
                {t('common.add')}
              </Button>
            </div>
            <div className="sm:col-span-5">
              <ErrorMessage error={createCat.error} />
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- refunds

function RefundsTab() {
  const { t } = useTranslation();
  const money = useMoney();
  const { can } = useSession();
  const refunds = useTenantQuery<RefundRow[]>(['refunds'], '/refunds');
  const decide = useTenantMutation<{ id: string; approve: boolean }>('POST', (b) => `/refunds/${b.id}/decision`, [['refunds'], ['statement']]);
  return (
    <Card>
      <ErrorMessage error={decide.error} />
      {refunds.isPending ? (
        <Loading />
      ) : refunds.data?.length === 0 ? (
        <Empty>{t('fees.noRefunds')}</Empty>
      ) : (
        <Table head={[t('students.name'), t('fees.amount'), t('common.reason'), t('common.status'), '']}>
          {refunds.data?.map((r) => (
            <tr key={r.id}>
              <td>
                {r.student.lastName} {r.student.firstName}
              </td>
              <td className="tabular">{money(r.amount, r.currency)}</td>
              <td>{r.reason}</td>
              <td>
                <Badge tone={r.status === 'APPROVED' ? 'green' : r.status === 'REJECTED' ? 'red' : 'amber'}>{t(`fees.refundStatuses.${r.status}`)}</Badge>
              </td>
              <td className="text-right">
                {r.status === 'REQUESTED' && can('payments.refund.approve') && (
                  r.isMine ? (
                    <span className="text-xs text-slate-500">{t('fees.cannotApproveOwn')}</span>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => decide.mutate({ id: r.id, approve: false })}>
                        {t('fees.reject')}
                      </Button>
                      <Button onClick={() => decide.mutate({ id: r.id, approve: true })}>{t('fees.approve')}</Button>
                    </div>
                  )
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- settings

function SettingsTab() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const today = useSchoolToday();
  const settings = useTenantQuery<FinanceSettings>(['finance-settings'], '/finance/settings');
  const rates = useTenantQuery<{ id: string; label: string; effectiveDate: string }[]>(['rates'], '/finance/exchange-rates');
  const periods = useTenantQuery<{ id: string; name: string; startDate: string; endDate: string; status: string }[]>(['periods'], '/finance/periods');
  const save = useTenantMutation<object>('PUT', '/finance/settings', [['finance-settings']]);
  const addRate = useTenantMutation<object>('POST', '/finance/exchange-rates', [['rates']]);
  const addPeriod = useTenantMutation<object>('POST', '/finance/periods', [['periods']]);
  const closePeriod = useTenantMutation<{ id: string }>('POST', (b) => `/finance/periods/${b.id}/close`, [['periods']]);
  const [rate, setRate] = useState({ baseCurrency: 'EUR', quoteCurrency: 'XAF', rate: '', effectiveDate: today });
  const [period, setPeriod] = useState({ name: '', startDate: '', endDate: '' });
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorMessage error={settings.error} />;
  const s = settings.data;
  const toggle = (code: string) =>
    save.mutate({
      enabledCurrencies: s.enabledCurrencies.includes(code) ? s.enabledCurrencies.filter((c) => c !== code) : [...s.enabledCurrencies, code],
      expenseApprovalThreshold: s.expenseApprovalThreshold,
    });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={t('fees.currencies')}>
        <p className="mb-3 text-sm text-slate-600">{t('fees.reportingCurrency', { currency: s.reportingCurrency })}</p>
        <div className="flex flex-wrap gap-2">
          {s.currencies?.map((c) => (
            <label key={c.code} className="flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-sm">
              <input type="checkbox" checked={s.enabledCurrencies.includes(c.code)} disabled={c.code === s.reportingCurrency || save.isPending} onChange={() => toggle(c.code)} />
              {c.code}
            </label>
          ))}
        </div>
        <ErrorMessage error={save.error} />
      </Card>

      <Card title={t('fees.exchangeRates')}>
        <form
          className="mb-4 grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            addRate.mutate(rate, { onSuccess: () => setRate({ ...rate, rate: '' }) });
          }}
        >
          <Field label={t('fees.from')}>
            <Input required maxLength={3} value={rate.baseCurrency} onChange={(e) => setRate({ ...rate, baseCurrency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t('fees.to')}>
            <Input required maxLength={3} value={rate.quoteCurrency} onChange={(e) => setRate({ ...rate, quoteCurrency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t('fees.rate')}>
            <Input required inputMode="decimal" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} />
          </Field>
          <Field label={t('fees.effective')}>
            <Input type="date" required value={rate.effectiveDate} onChange={(e) => setRate({ ...rate, effectiveDate: e.target.value })} />
          </Field>
          <div className="sm:col-span-4 space-y-2">
            <p className="text-xs text-slate-500">{t('fees.rateHelp')}</p>
            <ErrorMessage error={addRate.error} />
            <Button type="submit" disabled={addRate.isPending}>
              {t('common.add')}
            </Button>
          </div>
        </form>
        <ul className="divide-y divide-slate-100 text-sm">
          {rates.data?.map((r) => (
            <li key={r.id} className="flex justify-between py-1.5">
              <span className="tabular">{r.label}</span>
              <span className="tabular text-slate-500">{t('fees.since', { date: fmt(r.effectiveDate) })}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('fees.periods')}>
        <form
          className="mb-4 grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            addPeriod.mutate(period, { onSuccess: () => setPeriod({ name: '', startDate: '', endDate: '' }) });
          }}
        >
          <Field label={t('common.name')}>
            <Input required value={period.name} onChange={(e) => setPeriod({ ...period, name: e.target.value })} />
          </Field>
          <Field label={t('academicYears.startDate')}>
            <Input type="date" required value={period.startDate} onChange={(e) => setPeriod({ ...period, startDate: e.target.value })} />
          </Field>
          <Field label={t('academicYears.endDate')}>
            <Input type="date" required value={period.endDate} onChange={(e) => setPeriod({ ...period, endDate: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={addPeriod.isPending} className="w-full">
              {t('common.add')}
            </Button>
          </div>
        </form>
        <ErrorMessage error={addPeriod.error ?? closePeriod.error} />
        <ul className="divide-y divide-slate-100 text-sm">
          {periods.data?.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{p.name}</span>{' '}
                <span className="tabular text-slate-500">
                  {fmt(p.startDate)} → {fmt(p.endDate)}
                </span>
              </span>
              {p.status === 'CLOSED' ? (
                <Badge>{t('fees.closed')}</Badge>
              ) : (
                <Button variant="secondary" onClick={() => window.confirm(t('fees.closePeriodConfirm')) && closePeriod.mutate({ id: p.id })}>
                  {t('fees.closePeriod')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- receipt

export function ReceiptPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const money = useMoney();
  const fmt = useDateFormat();
  const receipt = useTenantQuery<{
    school: { legalName: string; tradingName: string | null };
    cashier: string | null;
    payment: PaymentView;
    balancesAfter: { currency: string; balance: string }[];
  }>(['receipt', id], `/payments/${id}/receipt`);
  if (receipt.isPending) return <Loading />;
  if (receipt.isError) return <ErrorMessage error={receipt.error} />;
  const { school, payment: p, cashier, balancesAfter } = receipt.data;
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex justify-between print:hidden">
        <Link to="/fees" className="text-sm text-accent-700 hover:underline">
          ← {t('nav.fees')}
        </Link>
        <Button onClick={() => window.print()}>{t('fees.print')}</Button>
      </div>
      <article className="rounded-lg border border-slate-300 bg-white p-8 print:border-0 print:p-0">
        <header className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-semibold">{school.tradingName ?? school.legalName}</h1>
            <p className="text-xs text-slate-500">{school.legalName}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">{t('fees.receipt')}</p>
            <p className="tabular text-lg font-semibold">{p.receipt}</p>
          </div>
        </header>
        {p.status === 'REVERSED' && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-center font-semibold uppercase tracking-wide text-danger-600">{t('fees.reversedStamp')}</p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-slate-500">{t('fees.receivedFrom')}</dt>
          <dd className="text-right font-medium">
            {p.student.lastName} {p.student.firstName} ({p.student.matricule})
          </dd>
          <dt className="text-slate-500">{t('fees.date')}</dt>
          <dd className="tabular text-right">{fmt(p.receivedOn)}</dd>
          <dt className="text-slate-500">{t('fees.method')}</dt>
          <dd className="text-right">
            {t(`fees.methods.${p.method}`)}
            {p.externalReference && ` — ${p.externalReference}`}
          </dd>
          <dt className="text-base font-medium">{t('fees.amount')}</dt>
          <dd className="tabular text-right text-xl font-semibold">{money(p.amount, p.currency)}</dd>
        </dl>
        <h2 className="mt-6 text-sm font-semibold">{t('fees.appliedTo')}</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {p.allocations.map((a) => (
            <li key={a.invoiceId} className="tabular flex justify-between">
              <span>{a.invoiceNumber}</span>
              <span>{money(a.invoiceAmount, a.invoiceCurrency)}</span>
            </li>
          ))}
          {Number(p.credit) > 0 && (
            <li className="flex justify-between text-amber-700">
              <span>{t('fees.creditLabel')}</span>
              <span className="tabular">{money(p.credit, p.currency)}</span>
            </li>
          )}
        </ul>
        <div className="mt-6 border-t border-slate-200 pt-3 text-sm">
          {balancesAfter.map((b) => (
            <p key={b.currency} className="flex justify-between">
              <span>{t('fees.remainingBalance')}</span>
              <span className="tabular font-medium">{money(b.balance, b.currency)}</span>
            </p>
          ))}
          <p className="mt-4 text-xs text-slate-500">{t('fees.issuedBy', { name: cashier ?? '—' })}</p>
        </div>
      </article>
    </div>
  );
}
