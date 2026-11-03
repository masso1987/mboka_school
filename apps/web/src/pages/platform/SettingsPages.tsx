import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LEGAL_KINDS, maintenanceState, type BrandingSettings, type MaintenanceSettings, type SecuritySettings } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { SchoolFilter } from './filters';

interface Settings {
  maintenance: MaintenanceSettings;
  security: SecuritySettings;
  branding: BrandingSettings;
}

const useSettings = () => useQuery({ queryKey: ['platform-settings'], queryFn: () => api<Settings>('/platform/settings') });

function useSaveSettings<K extends keyof Settings>(part: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: Settings[K]) => api<Settings[K]>(`/platform/settings/${part}`, { method: 'PUT', body: value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-settings'] });
      void qc.invalidateQueries({ queryKey: ['public-status'] });
    },
  });
}

/** ISO instant ↔ the browser's `datetime-local` value, in the viewer's time zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

// ------------------------------------------------------------ maintenance

/** Platform console → Maintenance: switch it on now, or schedule a window with an advance banner. */
export function PlatformMaintenancePage() {
  const { t } = useTranslation();
  const settings = useSettings();
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorMessage error={settings.error} />;
  return <MaintenanceForm key={JSON.stringify(settings.data.maintenance)} initial={settings.data.maintenance} title={t('nav.platformMaintenance')} />;
}

function MaintenanceForm({ initial, title }: { initial: MaintenanceSettings; title: string }) {
  const { t } = useTranslation();
  const [f, setF] = useState(initial);
  const save = useSaveSettings('maintenance');
  const state = maintenanceState(initial, new Date());
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">{t('platform.maintenanceHelp')}</p>
      <Card>
        <p className="mb-4 flex items-center gap-2 text-sm">
          <Badge tone={state.active ? 'red' : state.upcoming ? 'amber' : 'green'}>
            {state.active ? t('platform.maintenanceOn') : state.upcoming ? t('platform.maintenanceScheduled') : t('platform.maintenanceOff')}
          </Badge>
        </p>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate(f);
          }}
        >
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
            {t('platform.maintenanceNow')}
          </label>
          <Field label={t('platform.maintenanceMessage')}>
            <textarea className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={3} maxLength={500} value={f.message} placeholder={t('maintenance.default')} onChange={(e) => setF({ ...f, message: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('platform.windowStart')}>
              <Input type="datetime-local" value={toLocalInput(f.startsAt)} onChange={(e) => setF({ ...f, startsAt: fromLocalInput(e.target.value) })} />
            </Field>
            <Field label={t('platform.windowEnd')}>
              <Input type="datetime-local" value={toLocalInput(f.endsAt)} onChange={(e) => setF({ ...f, endsAt: fromLocalInput(e.target.value) })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} />
            {t('platform.maintenanceNotify')}
          </label>
          <ErrorMessage error={save.error} />
          {save.isSuccess && <p className="text-sm text-success-600">{t('platform.saved')}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setF({ ...f, startsAt: null, endsAt: null, notify: false })}>
              {t('platform.clearWindow')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ sessions and branding

/** Platform console → Settings: session lifetime, idle timeout and the platform's branding. */
export function PlatformSettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings();
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorMessage error={settings.error} />;
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platformSettings')} />
      <SecurityForm key={JSON.stringify(settings.data.security)} initial={settings.data.security} />
      <BrandingForm key={JSON.stringify(settings.data.branding)} initial={settings.data.branding} />
    </div>
  );
}

function SecurityForm({ initial }: { initial: SecuritySettings }) {
  const { t } = useTranslation();
  const [f, setF] = useState(initial);
  const save = useSaveSettings('security');
  return (
    <Card title={t('platform.sessionsTitle')}>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate(f);
        }}
      >
        <Field label={t('platform.sessionHours')} hint={t('platform.sessionHoursHint')}>
          <Input type="number" min={1} max={720} value={f.sessionHours} onChange={(e) => setF({ ...f, sessionHours: Number(e.target.value) })} />
        </Field>
        <Field label={t('platform.idleMinutes')} hint={t('platform.idleMinutesHint')}>
          <Input type="number" min={0} max={1440} value={f.idleMinutes} onChange={(e) => setF({ ...f, idleMinutes: Number(e.target.value) })} />
        </Field>
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
      <ErrorMessage error={save.error} />
      {save.isSuccess && <p className="mt-2 text-sm text-success-600">{t('platform.saved')}</p>}
    </Card>
  );
}

function BrandingForm({ initial }: { initial: BrandingSettings }) {
  const { t } = useTranslation();
  const [f, setF] = useState(initial);
  const save = useSaveSettings('branding');
  const text = (k: keyof BrandingSettings) => ({
    value: f[k] ?? '',
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value.trim() === '' && k !== 'name' ? null : e.target.value }),
  });
  return (
    <Card title={t('platform.brandingTitle')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate(f);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('platform.brandName')}>
            <Input required minLength={2} {...text('name')} />
          </Field>
          <Field label={t('platform.logoUrl')} hint={t('platform.logoUrlHint')}>
            <Input type="url" placeholder="https://…" {...text('logoUrl')} />
          </Field>
          <Field label={t('platform.primaryColor')}>
            <span className="flex gap-2">
              <input type="color" aria-label={t('platform.primaryColor')} value={f.primaryColor ?? '#165bb4'} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} className="h-10 w-14 rounded border border-slate-300" />
              <Button type="button" variant="ghost" onClick={() => setF({ ...f, primaryColor: null })}>
                {t('platform.defaultColor')}
              </Button>
            </span>
          </Field>
          <Field label={t('platform.footerText')}>
            <Input {...text('footerText')} />
          </Field>
          <Field label={t('platform.supportEmail')}>
            <Input type="email" {...text('supportEmail')} />
          </Field>
          <Field label={t('platform.supportPhone')}>
            <Input {...text('supportPhone')} />
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

// ------------------------------------------------------------ legal documents

interface LegalDoc {
  id: string;
  kind: string;
  locale: string;
  version: number;
  title: string;
  body: string;
  publishedAt: string;
}

/** Platform console → Legal documents: publish a new version (FR/EN); earlier versions stay readable. */
export function PlatformLegalPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const docs = useQuery({ queryKey: ['platform-legal'], queryFn: () => api<LegalDoc[]>('/platform/legal') });
  const [f, setF] = useState({ kind: 'terms', locale: 'fr', title: '', body: '' });
  const publish = useMutation({
    mutationFn: () => api<LegalDoc>('/platform/legal', { method: 'POST', body: f }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-legal'] });
      void qc.invalidateQueries({ queryKey: ['public-status'] });
    },
  });
  // Start from the current text of the chosen document, so a new version is an edit, not a blank page.
  const load = (kind: string, locale: string) => {
    const current = docs.data?.find((d) => d.kind === kind && d.locale === locale);
    setF({ kind, locale, title: current?.title ?? '', body: current?.body ?? '' });
    publish.reset();
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platformLegal')} />
      <Card title={t('platform.publishLegal')}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (window.confirm(t('platform.publishConfirm'))) publish.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('platform.legalKind')}>
              <Select value={f.kind} onChange={(e) => load(e.target.value, f.locale)}>
                {LEGAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`legal.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('platform.language')}>
              <Select value={f.locale} onChange={(e) => load(f.kind, e.target.value)}>
                <option value="fr">Français</option>
                <option value="en">English</option>
              </Select>
            </Field>
          </div>
          <Field label={t('platform.legalTitle')}>
            <Input required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label={t('platform.legalBody')} hint={t('platform.legalBodyHint')}>
            <textarea required minLength={20} rows={14} className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </Field>
          <ErrorMessage error={publish.error} />
          {publish.data && <p className="text-sm text-success-600">{t('platform.legalPublished', { version: publish.data.version })}</p>}
          <Button type="submit" disabled={publish.isPending}>
            {t('platform.publish')}
          </Button>
        </form>
      </Card>
      <Card title={t('platform.legalHistory')}>
        {docs.isPending ? (
          <Loading />
        ) : docs.isError ? (
          <ErrorMessage error={docs.error} />
        ) : docs.data.length === 0 ? (
          <Empty>{t('platform.noLegal')}</Empty>
        ) : (
          <Table head={[t('platform.legalKind'), t('platform.language'), 'Version', t('platform.legalTitle'), t('platform.when')]}>
            {docs.data.map((d) => (
              <tr key={d.id}>
                <td>{t(`legal.kinds.${d.kind}`)}</td>
                <td className="uppercase">{d.locale}</td>
                <td className="tabular">v{d.version}</td>
                <td className="text-sm">{d.title}</td>
                <td className="tabular text-sm">{new Date(d.publishedAt).toLocaleString()}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ messages

interface SentMessage {
  id: string;
  audience: string;
  school: string | null;
  subject: string;
  body: string;
  recipients: number;
  sentBy: string | null;
  createdAt: string;
}

/** Platform console → Messages: tell every school, one school, or only their administrators. */
export function PlatformMessagesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ['platform-messages'], queryFn: () => api<SentMessage[]>('/platform/messages') });
  const [f, setF] = useState({ audience: 'ALL_SCHOOLS', tenantId: '', subject: '', body: '' });
  const oneSchool = f.audience === 'SCHOOL' || f.audience === 'SCHOOL_ADMINS';
  const send = useMutation({
    mutationFn: () => api<{ recipients: number }>('/platform/messages', { method: 'POST', body: { ...f, tenantId: oneSchool ? f.tenantId : null } }),
    onSuccess: () => {
      setF({ ...f, subject: '', body: '' });
      void qc.invalidateQueries({ queryKey: ['platform-messages'] });
    },
  });
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platformMessages')} />
      <Card title={t('platform.newMessage')}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('platform.audience')}>
              <Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
                {['ALL_SCHOOLS', 'ALL_ADMINS', 'SCHOOL', 'SCHOOL_ADMINS'].map((a) => (
                  <option key={a} value={a}>
                    {t(`platform.audiences.${a}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {oneSchool && (
              <Field label={t('platform.school')}>
                <SchoolFilter value={f.tenantId} onChange={(tenantId) => setF({ ...f, tenantId })} />
              </Field>
            )}
          </div>
          <Field label={t('platform.subject')}>
            <Input required minLength={3} maxLength={150} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          </Field>
          <Field label={t('platform.messageBody')} hint={t('platform.messageHint')}>
            <textarea required minLength={3} maxLength={5000} rows={6} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </Field>
          <ErrorMessage error={send.error} />
          {send.data && <p className="text-sm text-success-600">{t('platform.messageSent', { count: send.data.recipients })}</p>}
          <Button type="submit" disabled={send.isPending || (oneSchool && !f.tenantId)}>
            {t('platform.send')}
          </Button>
        </form>
      </Card>
      <Card title={t('platform.sentMessages')}>
        {history.isPending ? (
          <Loading />
        ) : history.isError ? (
          <ErrorMessage error={history.error} />
        ) : history.data.length === 0 ? (
          <Empty>{t('platform.noMessages')}</Empty>
        ) : (
          <Table head={[t('platform.when'), t('platform.subject'), t('platform.audience'), t('platform.recipients'), t('platform.by')]}>
            {history.data.map((m) => (
              <tr key={m.id} className="align-top">
                <td className="tabular whitespace-nowrap text-sm">{new Date(m.createdAt).toLocaleString()}</td>
                <td>
                  <p className="font-medium">{m.subject}</p>
                  <p className="line-clamp-2 text-xs text-slate-500">{m.body}</p>
                </td>
                <td className="text-sm">
                  {t(`platform.audiences.${m.audience}`)}
                  {m.school && <p className="text-xs text-slate-500">{m.school}</p>}
                </td>
                <td className="tabular">{m.recipients}</td>
                <td className="text-sm">{m.sentBy ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
