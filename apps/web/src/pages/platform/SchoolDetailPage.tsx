import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useDateFormat } from '../../lib/hooks';
import { useMoney } from '../../lib/money';
import { stateTone } from '../SubscriptionTab';
import { SchoolBackupCard } from './BackupsPage';
import { statusTone } from './SchoolsPage';

interface Admin {
  userId: string;
  membershipId: string;
  email: string;
  fullName: string;
  status: string;
  accountActive: boolean;
  mfaEnabled: boolean;
  invitationPending: boolean;
  lastLoginAt: string | null;
}

interface SchoolDetail {
  tenant: { id: string; slug: string; legalName: string; tradingName: string | null; status: string; defaultLocale: string; defaultCurrency: string; timezone: string; city: string | null; phone: string | null; createdAt: string };
  subscription: { plan: string; state: string; endsAt: string | null; limits: { students: number; campuses: number; users: number }; usage: { students: number; campuses: number; users: number } };
  counts: { staff: number };
  admins: Admin[];
  activity: { id: string; action: string; actor: string | null; createdAt: string }[];
}

/** What a create/reset action hands back: an e-mail went out, or a one-time password to pass on. */
interface Issued {
  email: string;
  invitationSent?: boolean;
  emailSent?: boolean;
  temporaryPassword?: string;
}

/** Platform console → one school: identity, subscription, its admins (directors) and recent activity. */
export function PlatformSchoolDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const qc = useQueryClient();
  const key = ['platform-school', id];
  const school = useQuery({ queryKey: key, queryFn: () => api<SchoolDetail>(`/platform/schools/${id}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['platform-schools'] });
  };

  if (school.isPending) return <Loading />;
  if (school.isError) return <ErrorMessage error={school.error} />;
  const s = school.data;

  return (
    <div className="space-y-6">
      <Link to="/platform/schools" className="text-sm text-accent-700 hover:underline">
        ← {t('nav.platformSchools')}
      </Link>
      <PageHeader title={s.tenant.legalName} actions={<Badge tone={statusTone(s.tenant.status)}>{t(`platform.schoolStatus.${s.tenant.status}`)}</Badge>} />

      <div className="grid gap-6 lg:grid-cols-2">
        <EditCard school={s} onSaved={refresh} />
        <Card title={t('platform.subscriptionCard')}>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">{t('subscription.plan')}</dt>
            <dd>{s.subscription.plan}</dd>
            <dt className="text-slate-500">{t('common.status')}</dt>
            <dd>
              <Badge tone={stateTone(s.subscription.state)}>{t(`subscription.states.${s.subscription.state}`)}</Badge>
              {s.subscription.endsAt && <span className="ml-2 text-xs text-slate-500">{fmt(s.subscription.endsAt.slice(0, 10))}</span>}
            </dd>
            <dt className="text-slate-500">{t('platform.usage')}</dt>
            <dd className="tabular">
              {t('platform.usageLimits', {
                students: s.subscription.usage.students,
                maxStudents: s.subscription.limits.students,
                users: s.subscription.usage.users,
                maxUsers: s.subscription.limits.users,
              })}
            </dd>
            <dt className="text-slate-500">{t('platform.staff')}</dt>
            <dd className="tabular">{s.counts.staff}</dd>
            <dt className="text-slate-500">{t('platform.identifier')}</dt>
            <dd className="font-mono text-xs">{s.tenant.slug}</dd>
            {s.tenant.city && (
              <>
                <dt className="text-slate-500">{t('signup.city')}</dt>
                <dd>{s.tenant.city}</dd>
              </>
            )}
            {s.tenant.phone && (
              <>
                <dt className="text-slate-500">{t('signup.phone')}</dt>
                <dd>{s.tenant.phone}</dd>
              </>
            )}
          </dl>
        </Card>
      </div>

      <LicenceCard tenantId={s.tenant.id} onSaved={refresh} />
      <AdminsCard school={s} onChanged={refresh} />
      <SchoolBackupCard tenantId={s.tenant.id} />
      <StatusCard school={s} onChanged={refresh} />

      <Card title={t('platform.recentActivity')}>
        {s.activity.length === 0 ? (
          <Empty>{t('platform.noActivity')}</Empty>
        ) : (
          <Table head={[t('platform.when'), t('platform.action'), t('platform.by')]}>
            {s.activity.map((a) => (
              <tr key={a.id}>
                <td className="tabular text-sm">{new Date(a.createdAt).toLocaleString()}</td>
                <td className="font-mono text-xs">{a.action}</td>
                <td className="text-sm">{a.actor ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function EditCard({ school, onSaved }: { school: SchoolDetail; onSaved: () => void }) {
  const { t } = useTranslation();
  const initial = {
    legalName: school.tenant.legalName,
    tradingName: school.tenant.tradingName ?? '',
    defaultLocale: school.tenant.defaultLocale,
    defaultCurrency: school.tenant.defaultCurrency,
    timezone: school.tenant.timezone,
  };
  const [f, setF] = useState(initial);
  const save = useMutation({
    mutationFn: () => api(`/platform/schools/${school.tenant.id}`, { method: 'PATCH', body: { ...f, tradingName: f.tradingName.trim() || null } }),
    onSuccess: onSaved,
  });
  return (
    <Card title={t('platform.editSchool')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('platform.legalName')}>
          <Input required value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} />
        </Field>
        <Field label={t('platform.tradingName')}>
          <Input value={f.tradingName} onChange={(e) => setF({ ...f, tradingName: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('platform.language')}>
            <Select value={f.defaultLocale} onChange={(e) => setF({ ...f, defaultLocale: e.target.value })}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label={t('platform.currency')}>
            <Select value={f.defaultCurrency} onChange={(e) => setF({ ...f, defaultCurrency: e.target.value })}>
              {['XAF', 'XOF', 'EUR', 'USD'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('platform.timezone')}>
            <Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
          </Field>
        </div>
        <ErrorMessage error={save.error} />
        {save.isSuccess && <p className="text-sm text-success-600">{t('platform.saved')}</p>}
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}

interface Licence {
  plan: string;
  status: 'TRIALING' | 'ACTIVE' | 'CANCELED';
  maxStudents: number;
  maxCampuses: number;
  maxUsers: number;
  modules: string[] | null;
  trialEndsAt: string | null;
  currentUntil: string | null;
  notes: string | null;
}

/** The school's licence: plan, status, limits, licensed modules and validity, overriding the plan's terms. */
function LicenceCard({ tenantId, onSaved }: { tenantId: string; onSaved: () => void }) {
  const licence = useQuery({ queryKey: ['platform-licence', tenantId], queryFn: () => api<Licence>(`/platform/schools/${tenantId}/licence`) });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api<{ code: string; nameFr: string; monthlyPrice: string; maxStudents: number; maxCampuses: number; maxUsers: number }[]>('/platform/plans') });
  const prices = useQuery({ queryKey: ['platform-modules'], queryFn: () => api<{ module: string; monthlyPrice: string }[]>('/platform/modules') });
  if (licence.isPending || plans.isPending || prices.isPending) return <Loading />;
  if (licence.isError) return <ErrorMessage error={licence.error} />;
  if (plans.isError || prices.isError) return <ErrorMessage error={plans.error ?? prices.error} />;
  return <LicenceForm key={JSON.stringify(licence.data)} tenantId={tenantId} initial={licence.data} plans={plans.data} prices={prices.data} onSaved={onSaved} />;
}

function LicenceForm({
  tenantId,
  initial,
  plans,
  prices,
  onSaved,
}: {
  tenantId: string;
  initial: Licence;
  plans: { code: string; nameFr: string; monthlyPrice: string; maxStudents: number; maxCampuses: number; maxUsers: number }[];
  prices: { module: string; monthlyPrice: string }[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const qc = useQueryClient();
  const [f, setF] = useState(initial);
  const save = useMutation({
    mutationFn: () => api<Licence>(`/platform/schools/${tenantId}/licence`, { method: 'PUT', body: { ...f, notes: f.notes?.trim() || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-licence', tenantId] });
      onSaved();
    },
  });
  const all = f.modules === null;
  const enabled = (m: string) => all || f.modules!.includes(m);
  const toggle = (m: string) => {
    const current = f.modules ?? prices.map((p) => p.module);
    const next = current.includes(m) ? current.filter((x) => x !== m) : [...current, m];
    setF({ ...f, modules: next.length === prices.length ? null : next });
  };
  const plan = plans.find((p) => p.code === f.plan);
  // Indicative only: invoices still bill the plan price alone.
  const monthly = Number(plan?.monthlyPrice ?? 0) + prices.filter((p) => enabled(p.module)).reduce((sum, p) => sum + Number(p.monthlyPrice), 0);
  const num = (v: string) => Math.max(1, Number.parseInt(v, 10) || 1);

  return (
    <Card title={t('platform.licence')}>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('subscription.plan')}>
            <Select
              value={f.plan}
              onChange={(e) => {
                const p = plans.find((x) => x.code === e.target.value);
                setF({ ...f, plan: e.target.value, ...(p && { maxStudents: p.maxStudents, maxCampuses: p.maxCampuses, maxUsers: p.maxUsers }) });
              }}
            >
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.nameFr}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.status')}>
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Licence['status'] })}>
              {(['TRIALING', 'ACTIVE', 'CANCELED'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`platform.licenceStatus.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          {f.status === 'TRIALING' ? (
            <Field label={t('platform.trialEndsAt')}>
              <Input type="date" required value={f.trialEndsAt ?? ''} onChange={(e) => setF({ ...f, trialEndsAt: e.target.value || null })} />
            </Field>
          ) : (
            <Field label={t('platform.currentUntil')} hint={t('platform.currentUntilHint')}>
              <Input type="date" value={f.currentUntil ?? ''} onChange={(e) => setF({ ...f, currentUntil: e.target.value || null })} />
            </Field>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('platform.maxStudents')}>
            <Input type="number" min={1} value={f.maxStudents} onChange={(e) => setF({ ...f, maxStudents: num(e.target.value) })} />
          </Field>
          <Field label={t('platform.maxCampuses')}>
            <Input type="number" min={1} value={f.maxCampuses} onChange={(e) => setF({ ...f, maxCampuses: num(e.target.value) })} />
          </Field>
          <Field label={t('platform.maxUsers')}>
            <Input type="number" min={1} value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: num(e.target.value) })} />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">{t('platform.modules')}</legend>
          <p className="mb-2 text-xs text-slate-500">{t('platform.modulesHelp')}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {prices.map((p) => (
              <label key={p.module} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled(p.module)} onChange={() => toggle(p.module)} disabled={enabled(p.module) && !all && f.modules!.length === 1} />
                {t(`platform.module.${p.module}`)}
                {Number(p.monthlyPrice) > 0 && <span className="text-xs text-slate-500">+{money(p.monthlyPrice, 'XAF')}</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t('platform.licenceNotes')} hint={t('platform.licenceNotesHint')}>
          <textarea className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <p className="text-sm text-slate-600">{t('platform.indicativePrice', { amount: money(String(monthly), 'XAF') })}</p>
        <ErrorMessage error={save.error} />
        {save.isSuccess && <p className="text-sm text-success-600">{t('platform.saved')}</p>}
        <Button type="submit" disabled={save.isPending}>
          {t('platform.saveLicence')}
        </Button>
      </form>
    </Card>
  );
}

function AdminsCard({ school, onChanged }: { school: SchoolDetail; onChanged: () => void }) {
  const { t } = useTranslation();
  const base = `/platform/schools/${school.tenant.id}/admins`;
  const [f, setF] = useState({ fullName: '', email: '' });
  const [issued, setIssued] = useState<Issued | null>(null);
  const add = useMutation({
    mutationFn: () => api<{ invitationSent: boolean; temporaryPassword?: string }>(base, { method: 'POST', body: f }),
    onSuccess: (res) => {
      setIssued({ email: f.email, ...res });
      setF({ fullName: '', email: '' });
      onChanged();
    },
  });
  const reset = useMutation({
    mutationFn: (a: Admin) => api<{ emailSent: boolean; temporaryPassword?: string }>(`${base}/${a.userId}/reset`, { method: 'POST' }),
    onSuccess: (res, a) => setIssued({ email: a.email, ...res }),
  });
  const toggle = useMutation({
    mutationFn: (a: Admin) => api(`${base}/${a.userId}/status`, { method: 'PATCH', body: { active: a.status !== 'ACTIVE' } }),
    onSuccess: onChanged,
  });

  return (
    <Card title={t('platform.schoolAdmins')}>
      <p className="mb-3 text-sm text-slate-600">{t('platform.schoolAdminsHelp')}</p>
      {school.admins.length === 0 ? (
        <Empty>{t('platform.noAdmins')}</Empty>
      ) : (
        <Table head={[t('admin.fullName'), t('common.status'), t('admin.lastLogin'), '']}>
          {school.admins.map((a) => (
            <tr key={a.userId}>
              <td>
                <p className="font-medium">{a.fullName}</p>
                <p className="text-xs text-slate-500">{a.email}</p>
              </td>
              <td className="space-x-1">
                <Badge tone={a.status === 'ACTIVE' ? 'green' : 'amber'}>{t(`admin.statuses.${a.status}`)}</Badge>
                {a.invitationPending && <Badge tone="blue">{t('platform.invitationPending')}</Badge>}
                {a.mfaEnabled && <Badge>2FA</Badge>}
                {!a.accountActive && <Badge tone="red">{t('platform.accountDisabled')}</Badge>}
              </td>
              <td className="tabular text-sm">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : '—'}</td>
              <td className="space-x-2 whitespace-nowrap text-right">
                <Button variant="ghost" disabled={reset.isPending} onClick={() => window.confirm(t('platform.resetConfirm', { email: a.email })) && reset.mutate(a)}>
                  {t('platform.resetPassword')}
                </Button>
                <Button variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(a)}>
                  {a.status === 'ACTIVE' ? t('platform.pause') : t('platform.resume')}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ErrorMessage error={reset.error ?? toggle.error} />
      <IssuedNotice issued={issued} />

      <form
        className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
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
  );
}

/** One-time password (shown once) or "an e-mail was sent" after creating or resetting an account. */
export function IssuedNotice({ issued }: { issued: Issued | null }) {
  const { t } = useTranslation();
  if (!issued) return null;
  if (issued.temporaryPassword) {
    return (
      <div role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p>{t('platform.oneTimePassword', { email: issued.email })}</p>
        <p className="mt-1 select-all font-mono text-base">{issued.temporaryPassword}</p>
        <p className="mt-1 text-xs">{t('admin.tempPasswordWarning')}</p>
      </div>
    );
  }
  const key = issued.invitationSent ? 'platform.invitationSentTo' : issued.emailSent ? 'platform.resetSentTo' : 'platform.existingAccountAdded';
  return (
    <p role="status" className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-success-600">
      {t(key, { email: issued.email })}
    </p>
  );
}

function StatusCard({ school, onChanged }: { school: SchoolDetail; onChanged: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const suspended = school.tenant.status === 'SUSPENDED';
  const change = useMutation({
    mutationFn: () => api(`/platform/tenants/${school.tenant.id}/status`, { method: 'PATCH', body: { status: suspended ? 'ACTIVE' : 'SUSPENDED', reason } }),
    onSuccess: () => {
      setReason('');
      onChanged();
    },
  });
  if (school.tenant.status === 'CLOSED') return null;
  return (
    <Card title={suspended ? t('platform.reactivateSchool') : t('platform.suspendSchool')}>
      <p className="mb-3 text-sm text-slate-600">{suspended ? t('platform.reactivateHelp') : t('platform.suspendHelp')}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <Field label={t('platform.reason')} className="min-w-64 flex-1">
          <Input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button type="submit" variant={suspended ? 'primary' : 'danger'} disabled={change.isPending || reason.trim().length < 3}>
          {suspended ? t('platform.reactivate') : t('platform.suspend')}
        </Button>
      </form>
      <ErrorMessage error={change.error} />
    </Card>
  );
}
