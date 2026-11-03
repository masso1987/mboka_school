import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { csvHref, Pager, SchoolFilter } from './filters';

interface AuditRow {
  id: string;
  at: string;
  action: string;
  school: { id: string; name: string | null } | null;
  actor: { id: string; email: string; fullName: string } | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
}

/** Platform console → audit log: every recorded action of every school and of the platform, with its details. */
export function PlatformAuditPage() {
  const { t } = useTranslation();
  const [f, setF] = useState({ tenantId: '', actor: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => (setF({ ...f, ...patch }), setPage(1));
  const filters = { tenantId: f.tenantId, actor: f.actor.trim(), action: f.action.trim(), from: f.from, to: f.to };
  const params = new URLSearchParams({ page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).toString();
  const rows = useQuery({ queryKey: ['platform-audit', params], queryFn: () => api<{ total: number; page: number; pageSize: number; items: AuditRow[] }>(`/platform/audit?${params}`) });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.platformAudit')}
        actions={
          <a href={csvHref('/platform/audit', filters)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
            {t('platform.exportCsv')}
          </a>
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <Field label={t('platform.school')}>
            <SchoolFilter value={f.tenantId} onChange={(tenantId) => set({ tenantId })} />
          </Field>
          <Field label={t('platform.by')}>
            <Input value={f.actor} placeholder={t('platform.searchPeople')} onChange={(e) => set({ actor: e.target.value })} />
          </Field>
          <Field label={t('platform.action')} hint={t('platform.actionHint')}>
            <Input value={f.action} placeholder="platform." onChange={(e) => set({ action: e.target.value })} />
          </Field>
          <Field label={t('platform.from')}>
            <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field label={t('platform.to')}>
            <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          </Field>
        </div>
        {rows.isPending ? (
          <Loading />
        ) : rows.isError ? (
          <ErrorMessage error={rows.error} />
        ) : rows.data.items.length === 0 ? (
          <Empty>{t('platform.noActivity')}</Empty>
        ) : (
          <>
            <Table head={[t('platform.when'), t('platform.action'), t('platform.school'), t('platform.by'), '']}>
              {rows.data.items.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="tabular whitespace-nowrap text-sm">{new Date(r.at).toLocaleString()}</td>
                  <td>
                    <p className="font-mono text-xs">{r.action}</p>
                    {open === r.id && (
                      <pre className="mt-2 max-w-xl overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                        {JSON.stringify({ entity: r.entityType, id: r.entityId, ip: r.ip, details: r.metadata }, null, 2)}
                      </pre>
                    )}
                  </td>
                  <td className="text-sm">
                    {r.school ? (
                      <Link to={`/platform/schools/${r.school.id}`} className="text-accent-700 hover:underline">
                        {r.school.name ?? r.school.id}
                      </Link>
                    ) : (
                      <span className="text-slate-500">{t('platform.console')}</span>
                    )}
                  </td>
                  <td className="text-sm">{r.actor?.email ?? '—'}</td>
                  <td className="text-right">
                    <button type="button" className="text-sm text-accent-700 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      {open === r.id ? t('platform.hideDetails') : t('platform.details')}
                    </button>
                  </td>
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
