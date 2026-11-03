import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge, Button, Card, Empty, ErrorMessage, Input, Loading, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Pager, SchoolFilter } from './filters';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  platformRole: string;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  activeSessions: number;
  schools: { id: string; name: string; status: string; roles: string[] }[];
}

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
}

/** Platform console → Users & sessions: every account, its schools and open sessions; pause, resume or disconnect it. */
export function PlatformUsersPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page), ...(q.trim() && { q: q.trim() }), ...(status && { status }), ...(tenantId && { tenantId }) }).toString();
  const users = useQuery({ queryKey: ['platform-users', params], queryFn: () => api<{ total: number; page: number; pageSize: number; items: UserRow[] }>(`/platform/users?${params}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform-users'] });
  const toggle = useMutation({
    mutationFn: (u: UserRow) => api(`/platform/users/${u.id}/status`, { method: 'PATCH', body: { active: !u.isActive } }),
    onSuccess: () => void refresh(),
  });
  const disconnect = useMutation({
    mutationFn: (u: UserRow) => api<{ sessionsRevoked: number }>(`/platform/users/${u.id}/disconnect`, { method: 'POST' }),
    onSuccess: () => {
      void refresh();
      void qc.invalidateQueries({ queryKey: ['platform-user-sessions'] });
    },
  });
  const reset = () => setPage(1);

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platformUsers')} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-72" placeholder={t('platform.searchPeople')} value={q} onChange={(e) => (setQ(e.target.value), reset())} />
          <SchoolFilter value={tenantId} onChange={(v) => (setTenantId(v), reset())} />
          <Select className="max-w-44" value={status} onChange={(e) => (setStatus(e.target.value), reset())}>
            <option value="">{t('platform.allStatuses')}</option>
            <option value="active">{t('platform.active')}</option>
            <option value="paused">{t('platform.paused')}</option>
          </Select>
        </div>
        {users.isPending ? (
          <Loading />
        ) : users.isError ? (
          <ErrorMessage error={users.error} />
        ) : users.data.items.length === 0 ? (
          <Empty>{t('platform.noUsers')}</Empty>
        ) : (
          <>
            <Table head={[t('admin.fullName'), t('platform.schoolsCol'), t('admin.lastLogin'), t('platform.sessions'), '']}>
              {users.data.items.map((u) => {
                const self = u.id === me.user.id;
                return (
                  <tr key={u.id} className="align-top">
                    <td>
                      <p className="font-medium">
                        {u.fullName} {u.platformRole !== 'NONE' && <Badge tone="blue">{t('platform.platformBadge')}</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                      <p className="mt-1 space-x-1">
                        {!u.isActive && <Badge tone="red">{t('platform.paused')}</Badge>}
                        {u.mfaEnabled && <Badge>2FA</Badge>}
                      </p>
                    </td>
                    <td className="text-sm">
                      {u.schools.length === 0
                        ? '—'
                        : u.schools.map((s) => (
                            <p key={s.id}>
                              <Link to={`/platform/schools/${s.id}`} className="text-accent-700 hover:underline">
                                {s.name}
                              </Link>{' '}
                              <span className="text-xs text-slate-500">{s.roles.join(', ')}</span>
                              {s.status !== 'ACTIVE' && <span className="ml-1 text-xs text-warning-600">({t(`admin.statuses.${s.status}`)})</span>}
                            </p>
                          ))}
                    </td>
                    <td className="tabular text-sm">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
                    <td>
                      <button type="button" className="tabular text-sm text-accent-700 hover:underline disabled:text-slate-500" disabled={u.activeSessions === 0} onClick={() => setOpen(open === u.id ? null : u.id)}>
                        {u.activeSessions}
                      </button>
                    </td>
                    <td className="space-x-2 whitespace-nowrap text-right">
                      {self ? (
                        <span className="text-xs text-slate-500">{t('admin.you')}</span>
                      ) : (
                        <>
                          <Button variant="ghost" disabled={disconnect.isPending || u.activeSessions === 0} onClick={() => window.confirm(t('platform.disconnectConfirm', { email: u.email })) && disconnect.mutate(u)}>
                            {t('platform.disconnect')}
                          </Button>
                          <Button variant="ghost" disabled={toggle.isPending} onClick={() => (u.isActive ? window.confirm(t('platform.pauseConfirm', { email: u.email })) : true) && toggle.mutate(u)}>
                            {u.isActive ? t('platform.pause') : t('platform.resume')}
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            {open && <SessionsPanel userId={open} onClose={() => setOpen(null)} />}
            <Pager page={users.data.page} pageSize={users.data.pageSize} total={users.data.total} onPage={setPage} />
          </>
        )}
        <ErrorMessage error={toggle.error ?? disconnect.error} />
      </Card>
    </div>
  );
}

function SessionsPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['platform-user-sessions', userId], queryFn: () => api<SessionRow[]>(`/platform/users/${userId}/sessions`) });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/platform/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-user-sessions', userId] });
      void qc.invalidateQueries({ queryKey: ['platform-users'] });
    },
  });
  return (
    <div className="mt-4 rounded-md border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">{t('platform.openSessions')}</p>
        <Button variant="ghost" onClick={onClose}>
          {t('platform.close')}
        </Button>
      </div>
      {sessions.isPending ? (
        <Loading />
      ) : sessions.isError ? (
        <ErrorMessage error={sessions.error} />
      ) : sessions.data.length === 0 ? (
        <Empty>{t('platform.noSessions')}</Empty>
      ) : (
        <Table head={[t('platform.device'), 'IP', t('platform.started'), t('platform.lastSeen'), '']}>
          {sessions.data.map((s) => (
            <tr key={s.id}>
              <td className="max-w-80 truncate text-xs" title={s.userAgent ?? ''}>
                {s.userAgent ?? '—'}
              </td>
              <td className="font-mono text-xs">{s.ip ?? '—'}</td>
              <td className="tabular text-sm">{new Date(s.createdAt).toLocaleString()}</td>
              <td className="tabular text-sm">{s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : '—'}</td>
              <td className="text-right">
                <Button variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                  {t('platform.endSession')}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ErrorMessage error={revoke.error} />
    </div>
  );
}
