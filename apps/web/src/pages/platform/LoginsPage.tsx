import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { csvHref, Pager, SchoolFilter } from './filters';

interface LoginRow {
  id: string;
  at: string;
  action: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  user: { id: string; email: string; fullName: string } | null;
}

/** Platform console → sign-in history: every sign-in, two-factor step and failure, from the audit log. */
export function PlatformLoginsPage() {
  const { t } = useTranslation();
  const [f, setF] = useState({ q: '', tenantId: '', from: '', to: '', failuresOnly: '' });
  const [page, setPage] = useState(1);
  const set = (patch: Partial<typeof f>) => (setF({ ...f, ...patch }), setPage(1));
  const filters = { q: f.q.trim(), tenantId: f.tenantId, from: f.from, to: f.to, failuresOnly: f.failuresOnly };
  const params = new URLSearchParams({ page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).toString();
  const rows = useQuery({ queryKey: ['platform-logins', params], queryFn: () => api<{ total: number; page: number; pageSize: number; items: LoginRow[] }>(`/platform/logins?${params}`) });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.platformLogins')}
        actions={
          <a href={csvHref('/platform/logins', filters)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
            {t('platform.exportCsv')}
          </a>
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <Field label={t('platform.person')}>
            <Input value={f.q} placeholder={t('platform.searchPeople')} onChange={(e) => set({ q: e.target.value })} />
          </Field>
          <Field label={t('platform.school')}>
            <SchoolFilter value={f.tenantId} onChange={(tenantId) => set({ tenantId })} />
          </Field>
          <Field label={t('platform.from')}>
            <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field label={t('platform.to')}>
            <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={f.failuresOnly === 'true'} onChange={(e) => set({ failuresOnly: e.target.checked ? 'true' : '' })} />
            {t('platform.failuresOnly')}
          </label>
        </div>
        {rows.isPending ? (
          <Loading />
        ) : rows.isError ? (
          <ErrorMessage error={rows.error} />
        ) : rows.data.items.length === 0 ? (
          <Empty>{t('platform.noLogins')}</Empty>
        ) : (
          <>
            <Table head={[t('platform.when'), t('platform.person'), t('platform.result'), 'IP']}>
              {rows.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="tabular whitespace-nowrap text-sm">{new Date(r.at).toLocaleString()}</td>
                  <td>
                    {r.user ? (
                      <>
                        <p className="text-sm font-medium">{r.user.fullName}</p>
                        <p className="text-xs text-slate-500">{r.user.email}</p>
                      </>
                    ) : (
                      <span className="text-sm text-slate-500">{t('platform.unknownAccount')}</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={r.success ? 'green' : 'red'}>{t(`platform.signIn.${r.action.replace(/\./g, '_')}`, { defaultValue: r.action })}</Badge>
                    {r.reason && <p className="mt-1 text-xs text-slate-500">{t(`platform.failReason.${r.reason}`, { defaultValue: r.reason })}</p>}
                  </td>
                  <td className="font-mono text-xs">{r.ip ?? '—'}</td>
                </tr>
              ))}
            </Table>
            <Pager page={rows.data.page} pageSize={rows.data.pageSize} total={rows.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
