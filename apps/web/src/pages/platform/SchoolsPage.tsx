import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { createTenantSchema } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useDateFormat } from '../../lib/hooks';
import { stateTone } from '../SubscriptionTab';

interface SchoolRow {
  tenant: { id: string; slug: string; legalName: string; tradingName: string | null; status: string; createdAt: string };
  subscription: { plan: string; state: string; endsAt: string | null };
  students: number;
  users: number;
  admins: number;
}

export const statusTone = (s: string) => (s === 'ACTIVE' ? 'green' : s === 'SUSPENDED' ? 'amber' : 'red');

/** "Divine Bilingual École" → "divine-bilingual-ecole", within the 3–48 characters a school identifier allows. */
export function schoolSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

const emptySchool = { legalName: '', slug: '', ownerName: '', ownerEmail: '', defaultLocale: 'fr' as 'fr' | 'en', defaultCurrency: 'XAF' };

/** Provisions a school; its director is invited by e-mail, or gets a one-time password when no mail can be delivered. */
export function NewSchoolCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState(emptySchool);
  const [slugEdited, setSlugEdited] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; temporaryPassword?: string; invitationSent: boolean } | null>(null);
  const create = useMutation({
    mutationFn: (body: typeof emptySchool) =>
      api<{ tenantId: string; invitationSent: boolean; temporaryPassword?: string }>('/platform/tenants', { method: 'POST', body: { ...body, timezone: 'Africa/Douala' } }),
    onSuccess: (res, body) => {
      setCreated({ name: body.legalName, email: body.ownerEmail, temporaryPassword: res.temporaryPassword, invitationSent: res.invitationSent });
      setF(emptySchool);
      setSlugEdited(false);
      void qc.invalidateQueries({ queryKey: ['platform-subscriptions'] });
      void qc.invalidateQueries({ queryKey: ['platform-schools'] });
      void qc.invalidateQueries({ queryKey: ['platform-dashboard'] });
    },
  });
  const parsed = createTenantSchema.safeParse(f);

  return (
    <Card title={t('platform.newSchool')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setCreated(null);
          if (parsed.success) create.mutate(f);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('platform.legalName')}>
            <Input required value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value, slug: slugEdited ? f.slug : schoolSlug(e.target.value) })} />
          </Field>
          <Field label={t('platform.slug')} hint={t('platform.slugHint')}>
            <Input
              required
              value={f.slug}
              onChange={(e) => {
                setSlugEdited(true);
                setF({ ...f, slug: e.target.value.toLowerCase() });
              }}
            />
          </Field>
          <Field label={t('platform.ownerName')}>
            <Input required value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
          </Field>
          <Field label={t('platform.ownerEmail')}>
            <Input type="email" required value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} />
          </Field>
          <Field label={t('platform.language')}>
            <Select value={f.defaultLocale} onChange={(e) => setF({ ...f, defaultLocale: e.target.value as 'fr' | 'en' })}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label={t('platform.currency')}>
            <Select value={f.defaultCurrency} onChange={(e) => setF({ ...f, defaultCurrency: e.target.value })}>
              {['XAF', 'XOF', 'EUR', 'USD'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ErrorMessage error={create.error} />
        <Button type="submit" disabled={create.isPending || !parsed.success}>
          {t('platform.createSchool')}
        </Button>
      </form>
      {created?.temporaryPassword ? (
        <div role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{t('platform.createdWithPassword', { name: created.name, email: created.email })}</p>
          <p className="mt-1 select-all font-mono text-base">{created.temporaryPassword}</p>
          <p className="mt-1 text-xs">{t('admin.tempPasswordWarning')}</p>
        </div>
      ) : (
        created && (
          <p role="status" className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-success-600">
            {t(created.invitationSent ? 'platform.createdInvited' : 'platform.createdExisting', { name: created.name, email: created.email })}
          </p>
        )
      )}
    </Card>
  );
}

/** Platform console → Schools: every school, its subscription and size; opens a school's page. */
export function PlatformSchoolsPage() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const params = new URLSearchParams({ ...(q.trim() && { q: q.trim() }), ...(status && { status }) }).toString();
  const rows = useQuery({ queryKey: ['platform-schools', params], queryFn: () => api<SchoolRow[]>(`/platform/schools${params ? `?${params}` : ''}`) });

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platformSchools')} />
      <NewSchoolCard />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-72" placeholder={t('platform.searchSchools')} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('platform.allStatuses')}</option>
            {['ACTIVE', 'SUSPENDED', 'CLOSED'].map((s) => (
              <option key={s} value={s}>
                {t(`platform.schoolStatus.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        {rows.isPending ? (
          <Loading />
        ) : rows.isError ? (
          <ErrorMessage error={rows.error} />
        ) : rows.data.length === 0 ? (
          <Empty>{t('platform.noSchools')}</Empty>
        ) : (
          <Table head={[t('platform.school'), t('common.status'), t('subscription.plan'), t('platform.usage'), t('platform.admins')]}>
            {rows.data.map((r) => (
              <tr key={r.tenant.id}>
                <td>
                  <Link to={`/platform/schools/${r.tenant.id}`} className="font-medium text-accent-700 hover:underline">
                    {r.tenant.legalName}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {r.tenant.slug} · {fmt(r.tenant.createdAt.slice(0, 10))}
                  </p>
                </td>
                <td>
                  <Badge tone={statusTone(r.tenant.status)}>{t(`platform.schoolStatus.${r.tenant.status}`)}</Badge>
                </td>
                <td>
                  <p>{r.subscription.plan}</p>
                  <Badge tone={stateTone(r.subscription.state)}>{t(`subscription.states.${r.subscription.state}`)}</Badge>
                </td>
                <td className="tabular text-sm">{t('platform.usageLine', { students: r.students, users: r.users })}</td>
                <td className="tabular">{r.admins === 0 ? <Badge tone="red">0</Badge> : r.admins}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
