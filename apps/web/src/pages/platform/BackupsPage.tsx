import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Table } from '../../components/ui';
import { api, postAndSave } from '../../lib/api';
import { SchoolFilter } from './filters';
import { bytes } from './SystemPage';

interface BackupsState {
  configured: boolean;
  agent: { running: boolean; lastSeen: string | null };
  backups: { name: string; bytes: number; createdAt: string; checksum: boolean }[];
  requests: { id: string; kind: string; file: string | null; requestedAt: string; by: string; status: 'WAITING' | 'RUNNING' | 'DONE' | 'FAILED'; output: string | null }[];
}

const statusTone = { WAITING: 'slate', RUNNING: 'blue', DONE: 'green', FAILED: 'red' } as const;

/** Platform console → Backups: one school's data (encrypted with your password), and the whole database. */
export function PlatformBackupsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ['platform-backups'],
    queryFn: () => api<BackupsState>('/platform/backups'),
    // Follow a running request until it finishes.
    refetchInterval: (q) => (q.state.data?.requests.some((r) => r.status === 'WAITING' || r.status === 'RUNNING') ? 5_000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform-backups'] });
  const run = useMutation({ mutationFn: () => api('/platform/backups', { method: 'POST' }), onSuccess: () => void refresh() });
  const test = useMutation({ mutationFn: (name: string) => api(`/platform/backups/${encodeURIComponent(name)}/restore-test`, { method: 'POST' }), onSuccess: () => void refresh() });
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platformBackups')} />
      <SchoolBackupCard />

      <Card title={t('backups.database')}>
        {state.isPending ? (
          <Loading />
        ) : state.isError ? (
          <ErrorMessage error={state.error} />
        ) : !state.data.configured ? (
          <p className="text-sm text-slate-600">{t('backups.notConfigured')}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                <Badge tone={state.data.agent.running ? 'green' : 'red'}>{state.data.agent.running ? t('backups.agentOn') : t('backups.agentOff')}</Badge>
                {state.data.agent.lastSeen && <span className="ml-2 text-xs text-slate-500">{t('backups.lastSeen', { time: new Date(state.data.agent.lastSeen).toLocaleString() })}</span>}
              </p>
              <Button disabled={run.isPending} onClick={() => run.mutate()}>
                {t('backups.runNow')}
              </Button>
            </div>
            {!state.data.agent.running && <p className="text-sm text-warning-600">{t('backups.agentHelp')}</p>}
            <ErrorMessage error={run.error ?? test.error} />

            {state.data.backups.length === 0 ? (
              <Empty>{t('backups.none')}</Empty>
            ) : (
              <Table head={[t('backups.file'), t('platform.when'), t('system.size'), '']}>
                {state.data.backups.map((b) => (
                  <tr key={b.name}>
                    <td className="font-mono text-xs">
                      {b.name} {b.checksum && <Badge>sha256</Badge>}
                    </td>
                    <td className="tabular text-sm">{new Date(b.createdAt).toLocaleString()}</td>
                    <td className="tabular text-sm">{bytes(b.bytes)}</td>
                    <td className="space-x-2 whitespace-nowrap text-right">
                      <a href={`/api/v1/platform/backups/${encodeURIComponent(b.name)}/download`} className="text-sm font-medium text-accent-700 hover:underline">
                        {t('backups.download')}
                      </a>
                      <Button variant="ghost" disabled={test.isPending} onClick={() => test.mutate(b.name)}>
                        {t('backups.restoreTest')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}

            {state.data.requests.length > 0 && (
              <div>
                <p className="mb-2 font-medium">{t('backups.requests')}</p>
                <Table head={[t('platform.when'), t('platform.action'), t('common.status'), t('platform.by'), '']}>
                  {state.data.requests.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="tabular whitespace-nowrap text-sm">{new Date(r.requestedAt).toLocaleString()}</td>
                      <td className="text-sm">
                        {t(`backups.kind.${r.kind}`)}
                        {r.file && <p className="font-mono text-xs text-slate-500">{r.file}</p>}
                        {open === r.id && r.output && <pre className="mt-2 max-w-2xl whitespace-pre-wrap rounded bg-slate-900 p-2 font-mono text-xs text-slate-100">{r.output}</pre>}
                      </td>
                      <td>
                        <Badge tone={statusTone[r.status]}>{t(`backups.status.${r.status}`)}</Badge>
                      </td>
                      <td className="text-sm">{r.by}</td>
                      <td className="text-right">
                        {r.output && (
                          <button type="button" className="text-sm text-accent-700 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                            {open === r.id ? t('platform.hideDetails') : t('backups.output')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
            <p className="text-xs text-slate-500">{t('backups.restoreHelp')}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Downloads one school's data, encrypted with a password typed here (never stored). Used here and on a school's page. */
export function SchoolBackupCard({ tenantId }: { tenantId?: string }) {
  const { t } = useTranslation();
  const [school, setSchool] = useState(tenantId ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const download = useMutation({ mutationFn: () => postAndSave(`/platform/schools/${school}/backup`, { password }, 'ecole.json.gz.enc') });
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <Card title={t('backups.school')}>
      <p className="mb-3 text-sm text-slate-600">{t('backups.schoolHelp')}</p>
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!mismatch) download.mutate();
        }}
      >
        {!tenantId && (
          <Field label={t('platform.school')}>
            <SchoolFilter value={school} onChange={setSchool} />
          </Field>
        )}
        <Field label={t('backups.password')} hint={t('backups.passwordHint')}>
          <Input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t('account.confirmPassword')}>
          <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
        </Field>
        <Button type="submit" disabled={download.isPending || !school || password.length < 12 || mismatch}>
          {download.isPending ? t('common.loading') : t('backups.downloadSchool')}
        </Button>
      </form>
      {mismatch && <p className="mt-2 text-sm text-danger-600">{t('account.mismatch')}</p>}
      <ErrorMessage error={download.error} />
      {download.isSuccess && <p className="mt-2 text-sm text-success-600">{t('backups.schoolDone')}</p>}
      <p className="mt-3 text-xs text-slate-500">
        {t('backups.howToOpen')} <code className="select-all rounded bg-slate-100 px-1">openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in FICHIER.json.gz.enc | gunzip &gt; ecole.json</code>
      </p>
    </Card>
  );
}
