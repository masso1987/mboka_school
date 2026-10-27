import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMPLOYMENT_TYPES } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table } from '../components/ui';
import { useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Page, StaffRow, UserRow } from '../lib/types';

export function StaffPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const staff = useTenantQuery<Page<StaffRow>>(['staff', q], `/staff?pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ''}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.hr')}
        actions={can('hr.staff.manage') && <Button onClick={() => setCreating((v) => !v)}>{creating ? t('common.cancel') : t('staff.new')}</Button>}
      />
      {creating && <NewStaffForm onDone={() => setCreating(false)} />}
      <Card>
        <Input type="search" placeholder={t('staff.search')} aria-label={t('staff.search')} value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-md" />
        {staff.isPending ? (
          <Loading />
        ) : staff.isError ? (
          <ErrorMessage error={staff.error} />
        ) : staff.data.items.length === 0 ? (
          <Empty>{t('staff.empty')}</Empty>
        ) : (
          <Table head={[t('staff.number'), t('students.name'), t('staff.position'), t('staff.employmentType'), t('staff.account')]}>
            {staff.data.items.map((s) => (
              <tr key={s.id}>
                <td className="tabular">{s.staffNumber}</td>
                <td className="font-medium">
                  {s.lastName} {s.firstName} {s.isTeacher && <Badge tone="blue">{t('staff.teacher')}</Badge>}
                </td>
                <td>{s.position}</td>
                <td>{t(`staff.types.${s.employmentType}`)}</td>
                <td>{s.membershipId ? <Badge tone="green">{t('staff.linked')}</Badge> : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function NewStaffForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const users = useTenantQuery<UserRow[]>(['users'], can('users.read') ? '/users' : null);
  const empty = { firstName: '', lastName: '', position: '', phone: '', email: '', employmentType: 'PERMANENT', isTeacher: false, membershipId: '', hireDate: '' };
  const [f, setF] = useState(empty);
  const create = useTenantMutation<object>('POST', '/staff', [['staff']]);
  const unlinked = users.data?.filter((u) => !u.staff && u.status === 'ACTIVE') ?? [];

  return (
    <Card title={t('staff.new')}>
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            {
              firstName: f.firstName,
              lastName: f.lastName,
              position: f.position,
              employmentType: f.employmentType,
              isTeacher: f.isTeacher,
              ...(f.phone && { phone: f.phone }),
              ...(f.email && { email: f.email }),
              ...(f.hireDate && { hireDate: f.hireDate }),
              ...(f.membershipId && { membershipId: f.membershipId }),
            },
            { onSuccess: onDone },
          );
        }}
      >
        <Field label={t('students.lastName')}>
          <Input required value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        </Field>
        <Field label={t('students.firstName')}>
          <Input required value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        </Field>
        <Field label={t('staff.position')}>
          <Input required value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} />
        </Field>
        <Field label={t('students.phone')}>
          <Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label={t('admin.email')}>
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label={t('staff.hireDate')}>
          <Input type="date" value={f.hireDate} onChange={(e) => setF({ ...f, hireDate: e.target.value })} />
        </Field>
        <Field label={t('staff.employmentType')}>
          <Select value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value })}>
            {EMPLOYMENT_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`staff.types.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('staff.account')} hint={t('staff.accountHint')}>
          <Select value={f.membershipId} onChange={(e) => setF({ ...f, membershipId: e.target.value })}>
            <option value="" />
            {unlinked.map((u) => (
              <option key={u.membershipId} value={u.membershipId}>
                {u.user.fullName} ({u.user.email})
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.isTeacher} onChange={(e) => setF({ ...f, isTeacher: e.target.checked })} />
          {t('staff.isTeacher')}
        </label>
        <div className="sm:col-span-3 space-y-2">
          <ErrorMessage error={create.error} />
          <Button type="submit" disabled={create.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
