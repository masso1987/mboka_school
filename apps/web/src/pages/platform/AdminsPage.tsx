import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorMessage, Field, Input, Loading, PageHeader, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { IssuedNotice } from './SchoolDetailPage';

interface PlatformAdmin {
  id: string;
  email: string;
  fullName: string;
  platformRole: string;
  isActive: boolean;
  mfaEnabled: boolean;
  invitationPending: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Platform console → platform administrators: the team that runs the service. Two-factor sign-in is mandatory for them. */
export function PlatformAdminsPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const qc = useQueryClient();
  const admins = useQuery({ queryKey: ['platform-admins'], queryFn: () => api<PlatformAdmin[]>('/platform/admins') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform-admins'] });
  const [f, setF] = useState({ fullName: '', email: '' });
  const [issued, setIssued] = useState<{ email: string; invitationSent?: boolean; emailSent?: boolean; temporaryPassword?: string } | null>(null);
  const add = useMutation({
    mutationFn: () => api<{ invitationSent: boolean; temporaryPassword?: string }>('/platform/admins', { method: 'POST', body: f }),
    onSuccess: (res) => {
      setIssued({ email: f.email, ...res });
      setF({ fullName: '', email: '' });
      void refresh();
    },
  });
  const reset = useMutation({
    mutationFn: (a: PlatformAdmin) => api<{ emailSent: boolean; temporaryPassword?: string }>(`/platform/admins/${a.id}/reset`, { method: 'POST' }),
    onSuccess: (res, a) => setIssued({ email: a.email, ...res }),
  });
  const toggle = useMutation({
    mutationFn: (a: PlatformAdmin) => api(`/platform/admins/${a.id}/status`, { method: 'PATCH', body: { active: !a.isActive } }),
    onSuccess: () => void refresh(),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platformAdmins')} />
      <Card>
        <p className="mb-3 text-sm text-slate-600">{t('platform.platformAdminsHelp')}</p>
        {admins.isPending ? (
          <Loading />
        ) : admins.isError ? (
          <ErrorMessage error={admins.error} />
        ) : (
          <Table head={[t('admin.fullName'), t('common.status'), t('admin.lastLogin'), '']}>
            {admins.data.map((a) => {
              const self = a.id === me.user.id;
              return (
                <tr key={a.id}>
                  <td>
                    <p className="font-medium">{a.fullName}</p>
                    <p className="text-xs text-slate-500">{a.email}</p>
                  </td>
                  <td className="space-x-1">
                    <Badge tone={a.isActive ? 'green' : 'red'}>{a.isActive ? t('platform.active') : t('platform.deactivated')}</Badge>
                    {a.invitationPending && <Badge tone="blue">{t('platform.invitationPending')}</Badge>}
                    <Badge tone={a.mfaEnabled ? 'slate' : 'amber'}>{a.mfaEnabled ? '2FA' : t('platform.noMfaYet')}</Badge>
                  </td>
                  <td className="tabular text-sm">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : '—'}</td>
                  <td className="space-x-2 whitespace-nowrap text-right">
                    {self ? (
                      <span className="text-xs text-slate-500">{t('admin.you')}</span>
                    ) : (
                      <>
                        <Button variant="ghost" disabled={reset.isPending} onClick={() => window.confirm(t('platform.resetConfirm', { email: a.email })) && reset.mutate(a)}>
                          {t('platform.resetPassword')}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={toggle.isPending}
                          onClick={() => (a.isActive ? window.confirm(t('platform.deactivateConfirm', { email: a.email })) : true) && toggle.mutate(a)}
                        >
                          {a.isActive ? t('platform.deactivate') : t('platform.reactivate')}
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        <ErrorMessage error={reset.error ?? toggle.error} />
        <IssuedNotice issued={issued} />
      </Card>

      <Card title={t('platform.addPlatformAdmin')}>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setIssued(null);
            add.mutate();
          }}
        >
          <Field label={t('admin.fullName')}>
            <Input required minLength={2} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
          </Field>
          <Field label={t('admin.email')}>
            <Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Button type="submit" disabled={add.isPending}>
            {t('platform.addAdmin')}
          </Button>
        </form>
        <ErrorMessage error={add.error} />
      </Card>
    </div>
  );
}
