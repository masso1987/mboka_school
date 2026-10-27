import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Table, Tabs } from '../components/ui';
import { useDateFormat, useLabel, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { RoleRow, UserRow } from '../lib/types';

type Tab = 'users' | 'campuses' | 'security';

export function AdministrationPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('users');
  return (
    <div>
      <PageHeader title={t('nav.administration')} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'users', label: t('admin.tabs.users') },
          { key: 'campuses', label: t('admin.tabs.campuses') },
          { key: 'security', label: t('admin.tabs.security') },
        ]}
      />
      {tab === 'users' ? <UsersTab /> : tab === 'campuses' ? <CampusesTab /> : <SecurityTab />}
    </div>
  );
}

function RolePicker({ roles, value, onChange }: { roles: RoleRow[]; value: string[]; onChange: (v: string[]) => void }) {
  const label = useLabel();
  return (
    <div className="flex flex-wrap gap-2">
      {roles.map((r) => {
        const on = value.includes(r.key);
        return (
          <label key={r.key} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${on ? 'border-accent-500 bg-accent-50' : 'border-slate-300'}`}>
            <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((k) => k !== r.key) : [...value, r.key])} />
            {on && '✓ '}
            {label(r)}
          </label>
        );
      })}
    </div>
  );
}

function UsersTab() {
  const { t } = useTranslation();
  const label = useLabel();
  const fmt = useDateFormat();
  const { can } = useSession();
  const users = useTenantQuery<UserRow[]>(['users'], '/users');
  const roles = useTenantQuery<RoleRow[]>(['roles'], '/roles');
  const [invite, setInvite] = useState({ email: '', fullName: '', roleKeys: [] as string[] });
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const create = useTenantMutation<typeof invite, { temporaryPassword?: string }>('POST', '/users', [['users']]);
  const [editing, setEditing] = useState<{ membershipId: string; roleKeys: string[] } | null>(null);
  const setRoles = useTenantMutation<{ membershipId: string; roleKeys: string[] }>('PUT', (b) => `/users/${b.membershipId}/roles`, [['users']]);
  const manage = can('users.permissions.manage');

  return (
    <div className="space-y-6">
      {manage && can('users.invite') && (
        <Card title={t('admin.invite')}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(invite, {
                onSuccess: (res) => {
                  setIssued(res.temporaryPassword ? { email: invite.email, password: res.temporaryPassword } : null);
                  setInvite({ email: '', fullName: '', roleKeys: [] });
                },
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin.fullName')}>
                <Input required value={invite.fullName} onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} />
              </Field>
              <Field label={t('admin.email')}>
                <Input type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
              </Field>
            </div>
            <Field label={t('admin.roles')}>
              <RolePicker roles={roles.data ?? []} value={invite.roleKeys} onChange={(roleKeys) => setInvite({ ...invite, roleKeys })} />
            </Field>
            <ErrorMessage error={create.error} />
            <Button type="submit" disabled={create.isPending || invite.roleKeys.length === 0}>
              {t('admin.inviteSubmit')}
            </Button>
          </form>
          {issued && (
            <div role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>{t('admin.tempPasswordIntro', { email: issued.email })}</p>
              <p className="mt-1 select-all font-mono text-base">{issued.password}</p>
              <p className="mt-1 text-xs">{t('admin.tempPasswordWarning')}</p>
            </div>
          )}
        </Card>
      )}

      <Card>
        {users.isPending ? (
          <Loading />
        ) : users.isError ? (
          <ErrorMessage error={users.error} />
        ) : (
          <Table head={[t('admin.fullName'), t('admin.roles'), t('admin.lastLogin'), t('common.status'), '']}>
            {users.data.map((u) => (
              <tr key={u.membershipId}>
                <td>
                  <p className="font-medium">
                    {u.user.fullName} {u.isSelf && <Badge>{t('admin.you')}</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{u.user.email}</p>
                </td>
                <td>
                  {editing?.membershipId === u.membershipId ? (
                    <div className="space-y-2">
                      <RolePicker roles={roles.data ?? []} value={editing.roleKeys} onChange={(roleKeys) => setEditing({ ...editing, roleKeys })} />
                      <ErrorMessage error={setRoles.error} />
                      <div className="flex gap-2">
                        <Button disabled={setRoles.isPending || editing.roleKeys.length === 0} onClick={() => setRoles.mutate(editing, { onSuccess: () => setEditing(null) })}>
                          {t('common.save')}
                        </Button>
                        <Button variant="ghost" onClick={() => setEditing(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r.key} tone="blue">
                          {label(r)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </td>
                <td className="tabular text-xs">{u.user.lastLoginAt ? fmt(u.user.lastLoginAt.slice(0, 10)) : '—'}</td>
                <td>
                  <Badge tone={u.status === 'ACTIVE' ? 'green' : 'red'}>{t(`admin.statuses.${u.status}`)}</Badge>
                </td>
                <td className="text-right">
                  {manage && !u.isSelf && editing?.membershipId !== u.membershipId && (
                    <Button variant="ghost" onClick={() => setEditing({ membershipId: u.membershipId, roleKeys: u.roles.map((r) => r.key) })}>
                      {t('admin.editRoles')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function CampusesTab() {
  const { t } = useTranslation();
  const { can } = useSession();
  const campuses = useTenantQuery<{ id: string; code: string; name: string; address: string | null }[]>(['campuses'], '/campuses');
  const empty = { code: '', name: '', address: '' };
  const [f, setF] = useState(empty);
  const create = useTenantMutation<object>('POST', '/campuses', [['campuses']]);

  return (
    <div className="space-y-6">
      {can('tenant.campuses.manage') && (
        <Card title={t('admin.newCampus')}>
          <form
            className="grid gap-4 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ code: f.code, name: f.name, ...(f.address && { address: f.address }) }, { onSuccess: () => setF(empty) });
            }}
          >
            <Field label={t('common.code')}>
              <Input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
            </Field>
            <Field label={t('common.name')}>
              <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label={t('admin.address')}>
              <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending} className="w-full">
                {t('common.add')}
              </Button>
            </div>
            <div className="sm:col-span-4">
              <ErrorMessage error={create.error} />
            </div>
          </form>
        </Card>
      )}
      <Card>
        {campuses.isPending ? (
          <Loading />
        ) : campuses.data?.length === 0 ? (
          <Empty>—</Empty>
        ) : (
          <Table head={[t('common.code'), t('common.name'), t('admin.address')]}>
            {campuses.data?.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.code}</td>
                <td>{c.name}</td>
                <td>{c.address ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/** School security policy (§11.1): require two-factor authentication for privileged staff. */
function SecurityTab() {
  const { t } = useTranslation();
  const { can, context } = useSession();
  const qc = useQueryClient();
  const current = context?.tenant.security?.requireMfaForPrivileged ?? false;
  const save = useTenantMutation<{ requireMfaForPrivileged: boolean }>('PUT', '/tenant/security');
  return (
    <Card title={t('admin.securityTitle')}>
      <p className="mb-3 text-sm text-slate-600">{t('admin.securityHelp')}</p>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={current}
          disabled={!can('tenant.settings.update') || save.isPending}
          onChange={(e) =>
            save.mutate({ requireMfaForPrivileged: e.target.checked }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-context'] }) })
          }
        />
        {t('admin.requireMfa')}
      </label>
      <div className="mt-3">
        <ErrorMessage error={save.error} />
      </div>
    </Card>
  );
}
