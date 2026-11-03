import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { statusTone } from './SchoolsPage';

interface Demo {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  daysLeft: number;
  logins: { role: string; email: string }[];
}

interface CreatedDemo {
  tenantId: string;
  name: string;
  expiresAt: string;
  password: string;
  logins: { role: string; email: string }[];
}

/** Platform console → demo schools: a ready-to-show school with sample data and logins, for a chosen number of days. */
export function PlatformDemosPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const demos = useQuery({ queryKey: ['platform-demos'], queryFn: () => api<Demo[]>('/platform/demos') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform-demos'] });
    void qc.invalidateQueries({ queryKey: ['platform-schools'] });
  };
  const [f, setF] = useState({ name: '', days: 14, locale: 'fr' as 'fr' | 'en' });
  const [created, setCreated] = useState<CreatedDemo | null>(null);
  const create = useMutation({
    mutationFn: () => api<CreatedDemo>('/platform/demos', { method: 'POST', body: f }),
    onSuccess: (res) => {
      setCreated(res);
      setF({ ...f, name: '' });
      refresh();
    },
  });
  const recreate = useMutation({
    mutationFn: (d: Demo) => api<CreatedDemo>(`/platform/demos/${d.id}/recreate`, { method: 'POST' }),
    onSuccess: (res) => {
      setCreated(res);
      refresh();
    },
  });
  const extend = useMutation({ mutationFn: ({ id, days }: { id: string; days: number }) => api(`/platform/demos/${id}/extend`, { method: 'POST', body: { days } }), onSuccess: refresh });
  const close = useMutation({ mutationFn: (d: Demo) => api(`/platform/demos/${d.id}/close`, { method: 'POST' }), onSuccess: refresh });

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platformDemos')} />
      <Card title={t('platform.newDemo')}>
        <p className="mb-3 text-sm text-slate-600">{t('platform.demoHelp')}</p>
        <form
          className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setCreated(null);
            create.mutate();
          }}
        >
          <Field label={t('platform.legalName')}>
            <Input required minLength={3} value={f.name} placeholder={t('platform.demoNamePlaceholder')} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={t('platform.demoDays')}>
            <Input type="number" min={1} max={90} value={f.days} onChange={(e) => setF({ ...f, days: Math.min(90, Math.max(1, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label={t('platform.language')}>
            <Select value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value as 'fr' | 'en' })}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t('platform.demoBuilding') : t('platform.createDemo')}
          </Button>
        </form>
        <ErrorMessage error={create.error ?? recreate.error} />
        {created && <DemoLogins demo={created} />}
      </Card>

      <Card title={t('platform.demoList')}>
        {demos.isPending ? (
          <Loading />
        ) : demos.isError ? (
          <ErrorMessage error={demos.error} />
        ) : demos.data.length === 0 ? (
          <Empty>{t('platform.noDemos')}</Empty>
        ) : (
          <Table head={[t('platform.school'), t('common.status'), t('platform.demoEnds'), t('platform.demoAccounts'), '']}>
            {demos.data.map((d) => (
              <tr key={d.id} className="align-top">
                <td>
                  <Link to={`/platform/schools/${d.id}`} className="font-medium text-accent-700 hover:underline">
                    {d.name}
                  </Link>
                  <p className="text-xs text-slate-500">{d.slug}</p>
                </td>
                <td>
                  <Badge tone={statusTone(d.status)}>{t(`platform.schoolStatus.${d.status}`)}</Badge>
                </td>
                <td className="tabular text-sm">
                  {new Date(d.expiresAt).toLocaleDateString()}
                  {d.status === 'ACTIVE' && <p className="text-xs text-slate-500">{t('platform.daysLeft', { count: d.daysLeft })}</p>}
                </td>
                <td className="text-xs">
                  {d.logins.map((l) => (
                    <p key={l.email}>
                      <span className="text-slate-500">{t(`platform.demoRole.${l.role}`)} :</span> <span className="select-all font-mono">{l.email}</span>
                    </p>
                  ))}
                </td>
                <td className="space-y-1 whitespace-nowrap text-right">
                  {d.status !== 'CLOSED' && (
                    <>
                      <Button variant="ghost" disabled={extend.isPending} onClick={() => extend.mutate({ id: d.id, days: 7 })}>
                        {t('platform.extend7')}
                      </Button>
                      <Button variant="ghost" disabled={close.isPending} onClick={() => window.confirm(t('platform.closeDemoConfirm', { name: d.name })) && close.mutate(d)}>
                        {t('platform.closeDemo')}
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" disabled={recreate.isPending} onClick={() => window.confirm(t('platform.recreateConfirm', { name: d.name })) && recreate.mutate(d)}>
                    {t('platform.recreate')}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <ErrorMessage error={extend.error ?? close.error} />
      </Card>
    </div>
  );
}

/** The demo's logins and their shared password, shown once. */
function DemoLogins({ demo }: { demo: CreatedDemo }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">{t('platform.demoReady', { name: demo.name, date: new Date(demo.expiresAt).toLocaleDateString() })}</p>
      <ul className="mt-2 space-y-1">
        {demo.logins.map((l) => (
          <li key={l.email}>
            {t(`platform.demoRole.${l.role}`)} : <span className="select-all font-mono">{l.email}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2">
        {t('platform.demoPassword')} <span className="select-all font-mono text-base">{demo.password}</span>
      </p>
      <p className="mt-1 text-xs">{t('platform.demoPasswordOnce')}</p>
    </div>
  );
}
