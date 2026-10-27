import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Badge, Button, Card, ErrorMessage, Field, Input, Loading, PageHeader, Table } from '../components/ui';
import { api } from '../lib/api';
import { useDateFormat } from '../lib/hooks';

interface AccountStatus {
  mfaEnabled: boolean;
  recoveryCodesLeft: number;
  passwordChangedAt: string | null;
}

/** The signed-in person's security: two-factor authentication, password, sessions (§11.1). */
export function AccountPage({ mandatory = false }: { mandatory?: boolean }) {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ['account'], queryFn: () => api<AccountStatus>('/auth/account') });
  return (
    <div className="space-y-6">
      <PageHeader title={t('account.title')} />
      {mandatory && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t('account.mfaMandatory')}
        </p>
      )}
      {status.isPending ? <Loading /> : status.isError ? <ErrorMessage error={status.error} /> : <MfaCard status={status.data} />}
      <PasswordCard />
      {!mandatory && <SessionsCard />}
    </div>
  );
}

function MfaCard({ status }: { status: AccountStatus }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string>('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disable, setDisable] = useState({ password: '', code: '' });
  const start = useMutation({ mutationFn: () => api<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', { method: 'POST' }), onSuccess: setSetup });
  const enable = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: { code } }),
    onSuccess: async (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      // Enabling signs out the other sessions server-side.
      await qc.invalidateQueries({ queryKey: ['account'] });
      await qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const off = useMutation({
    mutationFn: () => api('/auth/mfa/disable', { method: 'POST', body: disable }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account'] }),
  });

  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 192 }).then(setQr);
  }, [setup]);

  return (
    <Card title={t('account.mfa')} actions={<Badge tone={status.mfaEnabled ? 'green' : 'amber'}>{status.mfaEnabled ? t('account.on') : t('account.off')}</Badge>}>
      {codes ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-success-600">{t('account.enabled')}</p>
          <p className="text-sm text-slate-700">{t('account.recoveryIntro')}</p>
          <ul className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-4 font-mono text-sm sm:grid-cols-5">
            {codes.map((c) => (
              <li key={c} className="select-all">
                {c}
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            {t('account.continue')}
          </Button>
        </div>
      ) : status.mfaEnabled ? (
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            off.mutate();
          }}
        >
          <p className="text-sm text-slate-600">{t('account.recoveryLeft', { count: status.recoveryCodesLeft })}</p>
          <details>
            <summary className="cursor-pointer text-sm text-danger-600">{t('account.disable')}</summary>
            <div className="mt-3 grid max-w-md gap-3">
              <Field label={t('auth.password')}>
                <Input type="password" autoComplete="current-password" required value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} />
              </Field>
              <Field label={t('account.code')}>
                <Input inputMode="numeric" autoComplete="one-time-code" required value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} />
              </Field>
              <ErrorMessage error={off.error} />
              <Button type="submit" variant="danger" disabled={off.isPending}>
                {t('account.disableConfirm')}
              </Button>
            </div>
          </details>
        </form>
      ) : setup ? (
        <form
          className="grid gap-4 sm:grid-cols-[auto_1fr]"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            enable.mutate();
          }}
        >
          {qr && <img src={qr} alt={t('account.qrAlt')} width={192} height={192} className="rounded border border-slate-200" />}
          <div className="space-y-3">
            <p className="text-sm text-slate-700">{t('account.scan')}</p>
            <p className="text-xs text-slate-500">
              {t('account.manual')} <span className="select-all font-mono">{setup.secret}</span>
            </p>
            <Field label={t('account.code')}>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="max-w-40 tabular tracking-widest" />
            </Field>
            <ErrorMessage error={enable.error} />
            <Button type="submit" disabled={enable.isPending || code.length !== 6}>
              {t('account.activate')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('account.mfaHelp')}</p>
          <ErrorMessage error={start.error} />
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            {t('account.setup')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const change = useMutation({
    mutationFn: () => api<{ otherSessionsRevoked: number }>('/auth/password', { method: 'POST', body: { currentPassword: f.currentPassword, newPassword: f.newPassword } }),
    onSuccess: () => {
      setF({ currentPassword: '', newPassword: '', confirm: '' });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const mismatch = f.confirm.length > 0 && f.confirm !== f.newPassword;
  return (
    <Card title={t('account.password')}>
      <form
        className="grid max-w-md gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!mismatch) change.mutate();
        }}
      >
        <Field label={t('account.currentPassword')}>
          <Input type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
        </Field>
        <Field label={t('account.newPassword')} hint={t('account.passwordHint')}>
          <Input type="password" autoComplete="new-password" minLength={10} required value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
        </Field>
        <Field label={t('account.confirmPassword')}>
          <Input type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} aria-invalid={mismatch} />
        </Field>
        {mismatch && <p className="text-sm text-danger-600">{t('account.mismatch')}</p>}
        <ErrorMessage error={change.error} />
        {change.data && <p className="text-sm text-success-600">{t('account.passwordChanged', { count: change.data.otherSessionsRevoked })}</p>}
        <Button type="submit" disabled={change.isPending || mismatch}>
          {t('account.changePassword')}
        </Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string | null; current: boolean }[]>('/auth/sessions'),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const others = useMutation({ mutationFn: () => api('/auth/sessions/revoke-others', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  return (
    <Card
      title={t('account.sessions')}
      actions={
        (sessions.data?.length ?? 0) > 1 && (
          <Button variant="secondary" onClick={() => others.mutate()} disabled={others.isPending}>
            {t('account.signOutOthers')}
          </Button>
        )
      }
    >
      {sessions.isPending ? (
        <Loading />
      ) : (
        <Table head={[t('account.device'), t('account.lastSeen'), '']}>
          {sessions.data?.map((s) => (
            <tr key={s.id}>
              <td className="text-sm">
                <span className="block max-w-md truncate">{s.userAgent ?? '—'}</span>
                <span className="tabular text-xs text-slate-500">{s.ip ?? ''}</span>
              </td>
              <td className="tabular text-xs">{fmt((s.lastSeenAt ?? s.createdAt).slice(0, 10))}</td>
              <td className="text-right">
                {s.current ? (
                  <Badge tone="green">{t('account.thisDevice')}</Badge>
                ) : (
                  <Button variant="ghost" onClick={() => revoke.mutate(s.id)}>
                    {t('account.revoke')}
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

/** Second login step: authenticator code or a recovery code. */
export function MfaVerifyPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const verify = useMutation({
    mutationFn: () => api('/auth/mfa/verify', { method: 'POST', body: { code } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const cancel = useMutation({ mutationFn: () => api('/auth/logout', { method: 'POST' }), onSettled: () => qc.setQueryData(['me'], null) });
  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy-900 px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify.mutate();
        }}
        className="w-full max-w-sm space-y-5 rounded-xl bg-white p-8 shadow-lg"
      >
        <div>
          <h1 className="text-2xl font-semibold">{t('account.verifyTitle')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('account.verifyHelp')}</p>
        </div>
        <Field label={t('account.code')}>
          <Input autoFocus inputMode="text" autoComplete="one-time-code" maxLength={12} required value={code} onChange={(e) => setCode(e.target.value.trim())} className="tabular text-lg tracking-widest" />
        </Field>
        <ErrorMessage error={verify.error} />
        <Button type="submit" className="w-full" disabled={verify.isPending || code.length < 6}>
          {t('account.verify')}
        </Button>
        <button type="button" className="w-full text-center text-sm text-slate-500 hover:underline" onClick={() => cancel.mutate()}>
          {t('common.cancel')}
        </button>
      </form>
    </div>
  );
}
