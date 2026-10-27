import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMPLOYMENT_TYPES, LEAVE_TYPES } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table, Tabs } from '../components/ui';
import { openBlob } from '../lib/api';
import { useDateFormat, useSchoolToday, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useMoney } from '../lib/money';
import { useSession } from '../lib/session';
import type { Page, StaffRow } from '../lib/types';
import { StaffPage } from './StaffPage';

type Tab = 'staff' | 'leave' | 'contracts' | 'compensation';
type StaffRef = { id: string; staffNumber: string; firstName: string; lastName: string };

const leaveTone = (s: string) => (s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : s === 'REQUESTED' ? 'amber' : 'slate');

/** Staff & HR (Module 11): records, leave, contracts, compensation — tabs filtered by permission. */
export function HrPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const items: { key: Tab; label: string }[] = [];
  if (can('hr.staff.read')) items.push({ key: 'staff', label: t('hr.tabs.staff') });
  if (can('hr.leave.request') || can('hr.leave.approve')) items.push({ key: 'leave', label: t('hr.tabs.leave') });
  if (can('hr.staff.read')) items.push({ key: 'contracts', label: t('hr.tabs.contracts') });
  if (can('hr.compensation.read')) items.push({ key: 'compensation', label: t('hr.tabs.compensation') });
  const [tab, setTab] = useState<Tab>(items[0]?.key ?? 'leave');
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.hr')} />
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === 'staff' && <StaffPage embedded />}
      {tab === 'leave' && <LeaveTab />}
      {tab === 'contracts' && <ContractsTab />}
      {tab === 'compensation' && <CompensationTab />}
    </div>
  );
}

function useStaffList(enabled: boolean) {
  return useTenantQuery<Page<StaffRow>>(['staff', 'all'], enabled ? '/staff?pageSize=100' : null);
}

function LeaveTab() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const today = useSchoolToday();
  const { can } = useSession();
  const year = Number(today.slice(0, 4));
  const leave = useTenantQuery<{ id: string; staff: StaffRef; type: string; startDate: string; endDate: string; days: number; reason: string | null; status: string; isMine: boolean; decisionNote: string | null }[]>(['leave'], '/hr/leave');
  const balances = useTenantQuery<{ staff: StaffRef; entitled: number; approved: number; pending: number; remaining: number }[]>(['leave-balances', year], can('hr.staff.read') ? `/hr/leave/balances?year=${year}` : null);
  const empty = { type: 'ANNUAL', startDate: '', endDate: '', reason: '' };
  const [f, setF] = useState(empty);
  const request = useTenantMutation<object, { days: number }>('POST', '/hr/leave', [['leave'], ['leave-balances']]);
  const decide = useTenantMutation<{ id: string; approve: boolean }>('POST', (b) => `/hr/leave/${b.id}/decision`, [['leave'], ['leave-balances']]);
  const cancel = useTenantMutation<string>('POST', (id) => `/hr/leave/${id}/cancel`, [['leave'], ['leave-balances']]);

  return (
    <div className="space-y-6">
      {can('hr.leave.request') && (
        <Card title={t('hr.requestLeave')}>
          <form
            className="grid gap-3 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              request.mutate({ type: f.type, startDate: f.startDate, endDate: f.endDate, ...(f.reason && { reason: f.reason }) }, { onSuccess: () => setF(empty) });
            }}
          >
            <Field label={t('hr.leaveType')}>
              <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {LEAVE_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`hr.leaveTypes.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('academicYears.startDate')}>
              <Input type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
            </Field>
            <Field label={t('academicYears.endDate')}>
              <Input type="date" required min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
            </Field>
            <Field label={t('common.reason')}>
              <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </Field>
            <div className="space-y-2 sm:col-span-4">
              <ErrorMessage error={request.error} />
              {request.data && <p className="text-sm text-success-600">{t('hr.requested', { days: request.data.days })}</p>}
              <Button type="submit" disabled={request.isPending}>
                {t('hr.submitRequest')}
              </Button>
            </div>
          </form>
        </Card>
      )}
      <ErrorMessage error={decide.error ?? cancel.error} />
      <Card title={t('hr.requests')}>
        {leave.isPending ? (
          <Loading />
        ) : leave.data?.length === 0 ? (
          <Empty>{t('hr.noRequests')}</Empty>
        ) : (
          <Table head={[t('students.name'), t('hr.leaveType'), t('teaching.period'), t('hr.days'), t('common.status'), '']}>
            {leave.data?.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.staff.lastName} {r.staff.firstName}
                </td>
                <td>{t(`hr.leaveTypes.${r.type}`)}</td>
                <td className="tabular text-xs">
                  {fmt(r.startDate)} → {fmt(r.endDate)}
                </td>
                <td className="tabular">{r.days}</td>
                <td>
                  <Badge tone={leaveTone(r.status)}>{t(`hr.statuses.${r.status}`)}</Badge>
                  {r.decisionNote && <span className="block text-xs text-slate-500">{r.decisionNote}</span>}
                </td>
                <td className="text-right">
                  {r.status === 'REQUESTED' && r.isMine && (
                    <Button variant="ghost" onClick={() => cancel.mutate(r.id)}>
                      {t('common.cancel')}
                    </Button>
                  )}
                  {r.status === 'REQUESTED' && !r.isMine && can('hr.leave.approve') && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => decide.mutate({ id: r.id, approve: false })}>
                        {t('fees.reject')}
                      </Button>
                      <Button onClick={() => decide.mutate({ id: r.id, approve: true })}>{t('fees.approve')}</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {balances.data && (
        <Card title={t('hr.balances', { year })}>
          <Table head={[t('students.name'), t('hr.entitled'), t('hr.approved'), t('hr.pending'), t('hr.remaining')]}>
            {balances.data.map((b) => (
              <tr key={b.staff.id}>
                <td>
                  {b.staff.lastName} {b.staff.firstName}
                </td>
                <td className="tabular">{b.entitled}</td>
                <td className="tabular">{b.approved}</td>
                <td className="tabular">{b.pending}</td>
                <td className={`tabular font-medium ${b.remaining < 0 ? 'text-danger-600' : ''}`}>{b.remaining}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function ContractsTab() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const { can } = useSession();
  const staff = useStaffList(true);
  const expiring = useTenantQuery<{ id: string; staff: StaffRef; type: string; endDate: string; daysLeft: number }[]>(['contracts-expiring'], '/hr/contracts/expiring?days=60');
  const contracts = useTenantQuery<{ id: string; staff: StaffRef; type: string; position: string; startDate: string; endDate: string | null }[]>(['contracts'], '/hr/contracts');
  const empty = { staffId: '', type: 'CONTRACT', position: '', startDate: '', endDate: '' };
  const [f, setF] = useState(empty);
  const create = useTenantMutation<object>('POST', '/hr/contracts', [['contracts'], ['contracts-expiring'], ['staff']]);
  const [exportError, setExportError] = useState<unknown>(null);

  return (
    <div className="space-y-6">
      <Card title={t('hr.expiring')} actions={<Button variant="ghost" onClick={() => openBlob('/exports/staff.csv').catch(setExportError)}>{t('hr.exportStaff')}</Button>}>
        <ErrorMessage error={exportError} />
        {expiring.data?.length === 0 ? (
          <Empty>{t('hr.noneExpiring')}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {expiring.data?.map((c) => (
              <li key={c.id} className="flex justify-between py-2">
                <span>
                  {c.staff.lastName} {c.staff.firstName} — {t(`staff.types.${c.type}`)}
                </span>
                <Badge tone={c.daysLeft <= 15 ? 'red' : 'amber'}>{t('hr.daysLeft', { date: fmt(c.endDate), days: c.daysLeft })}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can('hr.staff.manage') && (
        <Card title={t('hr.newContract')}>
          <form
            className="grid gap-3 sm:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ staffId: f.staffId, type: f.type, position: f.position, startDate: f.startDate, ...(f.endDate && { endDate: f.endDate }) }, { onSuccess: () => setF(empty) });
            }}
          >
            <Field label={t('students.name')}>
              <Select required value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
                <option value="" />
                {staff.data?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.lastName} {s.firstName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('staff.employmentType')}>
              <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {EMPLOYMENT_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`staff.types.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('staff.position')}>
              <Input required value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} />
            </Field>
            <Field label={t('academicYears.startDate')}>
              <Input type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
            </Field>
            <Field label={t('academicYears.endDate')}>
              <Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
            </Field>
            <div className="space-y-2 sm:col-span-5">
              <ErrorMessage error={create.error} />
              <Button type="submit" disabled={create.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Card title={t('hr.contracts')}>
        {contracts.data?.length === 0 ? (
          <Empty>—</Empty>
        ) : (
          <Table head={[t('students.name'), t('staff.employmentType'), t('staff.position'), t('teaching.period')]}>
            {contracts.data?.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.staff.lastName} {c.staff.firstName}
                </td>
                <td>{t(`staff.types.${c.type}`)}</td>
                <td>{c.position}</td>
                <td className="tabular text-xs">
                  {fmt(c.startDate)} → {c.endDate ? fmt(c.endDate) : t('teaching.ongoing')}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function CompensationTab() {
  const { t } = useTranslation();
  const money = useMoney();
  const fmt = useDateFormat();
  const { can } = useSession();
  const staff = useStaffList(true);
  const [staffId, setStaffId] = useState('');
  const history = useTenantQuery<{ id: string; effectiveFrom: string; currency: string; baseSalary: string; allowances: { label: string; amount: string }[] }[]>(
    ['compensation', staffId],
    staffId ? `/hr/compensation/${staffId}` : null,
  );
  const [f, setF] = useState({ effectiveFrom: '', currency: 'XAF', baseSalary: '' });
  const record = useTenantMutation<object>('POST', '/hr/compensation', [['compensation', staffId]]);
  const [exportError, setExportError] = useState<unknown>(null);

  return (
    <Card title={t('hr.compensationTitle')} actions={<Button variant="ghost" onClick={() => openBlob('/exports/compensation.csv').catch(setExportError)}>{t('hr.exportCompensation')}</Button>}>
      <p className="mb-4 text-sm text-amber-800">{t('hr.confidential')}</p>
      <ErrorMessage error={exportError} />
      <Field label={t('students.name')} className="max-w-sm">
        <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="" />
          {staff.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.lastName} {s.firstName}
            </option>
          ))}
        </Select>
      </Field>
      {staffId && (
        <div className="mt-4 space-y-4">
          {history.isPending ? (
            <Loading />
          ) : history.data?.length === 0 ? (
            <Empty>{t('hr.noCompensation')}</Empty>
          ) : (
            <Table head={[t('hr.effectiveFrom'), t('hr.baseSalary'), t('hr.allowances')]}>
              {history.data?.map((c) => (
                <tr key={c.id}>
                  <td className="tabular">{fmt(c.effectiveFrom)}</td>
                  <td className="tabular">{money(c.baseSalary, c.currency)}</td>
                  <td className="text-xs">{c.allowances.map((x) => `${x.label} ${money(x.amount, c.currency)}`).join(' · ') || '—'}</td>
                </tr>
              ))}
            </Table>
          )}
          {can('hr.compensation.manage') && (
            <form
              className="grid gap-3 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                record.mutate({ staffId, ...f, baseSalary: f.baseSalary.replace(/\s/g, ''), allowances: [] }, { onSuccess: () => setF({ ...f, baseSalary: '' }) });
              }}
            >
              <Field label={t('hr.effectiveFrom')}>
                <Input type="date" required value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
              </Field>
              <Field label={t('fees.currency')}>
                <Input required maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
              </Field>
              <Field label={t('hr.baseSalary')}>
                <Input required inputMode="decimal" value={f.baseSalary} onChange={(e) => setF({ ...f, baseSalary: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={record.isPending}>
                  {t('hr.recordChange')}
                </Button>
              </div>
              <div className="sm:col-span-4">
                <ErrorMessage error={record.error} />
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
