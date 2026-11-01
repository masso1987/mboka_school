import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AUDIENCES } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table, Tabs } from '../components/ui';
import { useCurrentYear, useDateFormat, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { SchoolClass } from '../lib/types';

type Tab = 'feed' | 'outbox';

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: string;
  class: { id: string; name: string } | null;
  author: string | null;
  publishedAt: string;
  canDelete: boolean;
}

export function CommunityPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('feed');
  const items: { key: Tab; label: string }[] = [{ key: 'feed', label: t('community.tabs.feed') }];
  if (can('users.permissions.manage')) items.push({ key: 'outbox', label: t('community.tabs.outbox') });
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.community')} />
      {items.length > 1 && <Tabs value={tab} onChange={setTab} items={items} />}
      {tab === 'feed' ? <Feed /> : <Outbox />}
    </div>
  );
}

function Feed() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const { can } = useSession();
  const { current } = useCurrentYear();
  const feed = useTenantQuery<Announcement[]>(['announcements'], '/announcements');
  const classes = useTenantQuery<SchoolClass[]>(['classes', current?.id], can('announcements.publish') && current ? `/classes?academicYearId=${current.id}` : null);
  const empty = { title: '', body: '', audience: 'ALL', classId: '' };
  const [f, setF] = useState(empty);
  const publish = useTenantMutation<object, { recipients: number }>('POST', '/announcements', [['announcements']]);
  const remove = useTenantMutation<string>('DELETE', (id) => `/announcements/${id}`, [['announcements']]);

  return (
    <div className="space-y-6">
      {can('announcements.publish') && (
        <Card title={t('community.new')}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              publish.mutate({ title: f.title, body: f.body, audience: f.audience, ...(f.audience === 'CLASS' && { classId: f.classId }) }, { onSuccess: () => setF(empty) });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('community.title')} className="sm:col-span-2">
                <Input required minLength={3} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              </Field>
              <Field label={t('community.audience')}>
                <Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
                  {AUDIENCES.map((a) => (
                    <option key={a} value={a}>
                      {t(`community.audiences.${a}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {f.audience === 'CLASS' && (
              <Field label={t('students.class')} className="max-w-xs">
                <Select required value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}>
                  <option value="" />
                  {classes.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t('community.body')}>
              <textarea
                required
                minLength={3}
                maxLength={4000}
                rows={4}
                value={f.body}
                onChange={(e) => setF({ ...f, body: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <p className="text-xs text-slate-500">{t('community.privacy')}</p>
            <ErrorMessage error={publish.error} />
            {publish.data && <p className="text-sm text-success-600">{t('community.published', { count: publish.data.recipients })}</p>}
            <Button type="submit" disabled={publish.isPending}>
              {t('community.publish')}
            </Button>
          </form>
        </Card>
      )}
      {feed.isPending ? (
        <Loading />
      ) : feed.isError ? (
        <ErrorMessage error={feed.error} />
      ) : feed.data.length === 0 ? (
        <Card>
          <Empty>{t('community.empty')}</Empty>
        </Card>
      ) : (
        <ul className="space-y-3">
          {feed.data.map((a) => (
            <li key={a.id}>
              <article className="rounded-lg border border-slate-200 bg-white p-5">
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{a.title}</h2>
                    <p className="text-xs text-slate-500">
                      {fmt(a.publishedAt.slice(0, 10))} · {a.author ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="blue">{a.class ? a.class.name : t(`community.audiences.${a.audience}`)}</Badge>
                    {a.canDelete && can('announcements.publish') && (
                      <button type="button" aria-label={t('common.delete')} className="text-slate-400 hover:text-danger-600" onClick={() => window.confirm(t('community.deleteConfirm')) && remove.mutate(a.id)}>
                        ✕
                      </button>
                    )}
                  </div>
                </header>
                <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{a.body}</p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Outbox() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const [status, setStatus] = useState('');
  const rows = useTenantQuery<{
    counts: Record<string, number>;
    items: { id: string; channel: string; destination: string; status: string; attempts: number; lastError: string | null; title: string; createdAt: string }[];
  }>(['deliveries', status], `/notification-deliveries${status ? `?status=${status}` : ''}`);
  const process = useTenantMutation<object, { processed: number; sent: number; failed: number }>('POST', '/notification-deliveries/process', [['deliveries']]);
  const retry = useTenantMutation<string>('POST', (id) => `/notification-deliveries/${id}/retry`, [['deliveries']]);

  return (
    <Card
      title={t('community.outbox')}
      actions={
        <Button variant="secondary" onClick={() => process.mutate({})} disabled={process.isPending}>
          {t('community.process')}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t('community.outboxHelp')}</p>
      {process.data && <p className="mb-3 text-sm">{t('community.processed', process.data)}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        {['', 'PENDING', 'SENT', 'FAILED'].map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-sm ${status === s ? 'bg-accent-600 text-white' : 'bg-slate-100'}`}>
            {s ? `${t(`community.deliveryStatuses.${s}`)} (${rows.data?.counts[s] ?? 0})` : t('community.all')}
          </button>
        ))}
      </div>
      <ErrorMessage error={process.error ?? retry.error} />
      {rows.isPending ? (
        <Loading />
      ) : rows.data?.items.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <Table head={[t('fees.date'), t('community.title'), t('community.destination'), t('common.status'), '']}>
          {rows.data?.items.map((d) => (
            <tr key={d.id}>
              <td className="tabular">{fmt(d.createdAt.slice(0, 10))}</td>
              <td>{d.title}</td>
              <td className="tabular text-xs">{d.destination}</td>
              <td>
                <Badge tone={d.status === 'SENT' ? 'green' : d.status === 'FAILED' ? 'red' : 'amber'}>{t(`community.deliveryStatuses.${d.status}`)}</Badge>
                {d.lastError && <span className="block text-xs text-slate-500">{d.lastError} · ×{d.attempts}</span>}
              </td>
              <td className="text-right">
                {d.status === 'FAILED' && (
                  <Button variant="ghost" onClick={() => retry.mutate(d.id)}>
                    {t('common.retry')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
