import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnalyticsSettings } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Table, Tabs } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';

type Tab = 'overview' | 'health' | 'database' | 'sql' | 'services' | 'processes' | 'disk' | 'firewall' | 'analytics';
const TABS: Tab[] = ['overview', 'health', 'database', 'sql', 'services', 'processes', 'disk', 'firewall', 'analytics'];
const REFRESH_MS = 10_000;

export function bytes(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(x < 10 ? 1 : 0)} ${units[i]}`;
}

function duration(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d} j ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function Meter({ pct }: { pct: number }) {
  return (
    <div className="mt-2 h-2 w-full rounded bg-slate-100">
      <div className={`h-2 rounded ${pct >= 90 ? 'bg-danger-600' : pct >= 75 ? 'bg-amber-500' : 'bg-accent-600'}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function Tile({ label, value, sub, tone, children }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'bad'; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`tabular mt-1 text-2xl font-semibold ${tone === 'ok' ? 'text-success-600' : tone === 'bad' ? 'text-danger-600' : ''}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      {children}
    </div>
  );
}

/** Platform console → System & database: live health, database, SQL console, containers, processes, disk, firewall. */
export function PlatformSystemPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.platformSystem')} />
      <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">{t('system.intro')}</p>
      <Tabs value={tab} onChange={setTab} items={TABS.map((k) => ({ key: k, label: t(`system.tabs.${k}`) }))} />
      {tab === 'overview' && <Overview />}
      {tab === 'health' && <Health />}
      {tab === 'database' && <Database />}
      {tab === 'sql' && <SqlConsole />}
      {tab === 'services' && <Services />}
      {tab === 'processes' && <Processes />}
      {tab === 'disk' && <Disks />}
      {tab === 'firewall' && <Firewall />}
      {tab === 'analytics' && <Analytics />}
    </div>
  );
}

interface OverviewData {
  app: { up: boolean; uptimeSeconds: number };
  database: { up: boolean; latencyMs: number | null };
  disk: { total: number; free: number; usedPct: number } | null;
  memory: { total: number; free: number; usedPct: number };
  cpu: { processPct: number; load: number[]; cores: number };
  requests: { count: number; perMinute: number; p95Ms: number; errors5xx: number };
  alerts: { kind: string; value?: number }[];
  server: { hostname: string; system: string; uptimeSeconds: number; node: string; rss: number; release: string; docker: boolean };
}

function Overview() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['system-overview'], queryFn: () => api<OverviewData>('/platform/system/overview'), refetchInterval: REFRESH_MS });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorMessage error={q.error} />;
  const o = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label={t('system.application')} value={t('system.online')} tone="ok" sub={t('system.since', { time: duration(o.app.uptimeSeconds) })} />
        <Tile label={t('system.database')} value={o.database.up ? 'OK' : t('system.down')} tone={o.database.up ? 'ok' : 'bad'} sub={o.database.latencyMs !== null ? `PostgreSQL · ${o.database.latencyMs} ms` : undefined} />
        <Tile label={t('system.disk')} value={o.disk ? `${o.disk.usedPct} %` : '—'} sub={o.disk ? t('system.freeOf', { free: bytes(o.disk.free), total: bytes(o.disk.total) }) : undefined}>
          {o.disk && <Meter pct={o.disk.usedPct} />}
        </Tile>
        <Tile label={t('system.memory')} value={`${o.memory.usedPct} %`} sub={t('system.freeOf', { free: bytes(o.memory.free), total: bytes(o.memory.total) })}>
          <Meter pct={o.memory.usedPct} />
        </Tile>
        <Tile label={t('system.cpu')} value={`${o.cpu.processPct} %`} sub={t('system.load', { load: o.cpu.load.map((l) => l.toFixed(2)).join(' / '), cores: o.cpu.cores })} />
        <Tile label={t('system.requests')} value={o.requests.count} sub={t('system.requestsSub', { perMinute: o.requests.perMinute, p95: o.requests.p95Ms, errors: o.requests.errors5xx })} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('platform.alerts')}>
          {o.alerts.length === 0 ? (
            <p className="text-slate-600">{t('system.noAlerts')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {o.alerts.map((a) => (
                <li key={a.kind} className="text-danger-600">
                  {t(`system.alert.${a.kind}`, { value: a.value })}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('system.server')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-slate-500">{t('system.host')}</dt>
            <dd className="font-mono">{o.server.hostname}</dd>
            <dt className="text-slate-500">{t('system.system')}</dt>
            <dd>{o.server.system}</dd>
            <dt className="text-slate-500">{t('system.upSince')}</dt>
            <dd>{duration(o.server.uptimeSeconds)}</dd>
            <dt className="text-slate-500">Node.js</dt>
            <dd>
              {o.server.node} · {bytes(o.server.rss)} RAM
            </dd>
            <dt className="text-slate-500">Docker</dt>
            <dd>{o.server.docker ? t('system.mounted') : t('system.notMounted')}</dd>
            <dt className="text-slate-500">{t('system.version')}</dt>
            <dd className="font-mono">{o.server.release}</dd>
          </dl>
        </Card>
      </div>
      <p className="text-xs text-slate-500">{t('system.autoRefresh', { time: new Date(q.dataUpdatedAt).toLocaleTimeString() })}</p>
    </div>
  );
}

function Health() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['system-health'],
    queryFn: () =>
      api<{
        eventLoop: { meanMs: number; p99Ms: number; maxMs: number };
        memory: { rss: number; heapUsed: number; heapTotal: number; external: number };
        outbox: Record<string, number>;
        mobileMoneyPending: number;
        jobs: { mobileMoneyPollSeconds: number; demoSweepMinutes: number; emailProvider: string };
      }>('/platform/system/health'),
    refetchInterval: REFRESH_MS,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorMessage error={q.error} />;
  const h = q.data;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile label={t('system.eventLoop')} value={`${h.eventLoop.p99Ms} ms`} sub={t('system.eventLoopSub', { mean: h.eventLoop.meanMs, max: h.eventLoop.maxMs })} />
      <Tile label={t('system.heap')} value={bytes(h.memory.heapUsed)} sub={t('system.heapSub', { total: bytes(h.memory.heapTotal), rss: bytes(h.memory.rss) })} />
      <Tile
        label={t('system.outbox')}
        value={h.outbox.PENDING ?? 0}
        tone={(h.outbox.FAILED ?? 0) > 0 ? 'bad' : undefined}
        sub={t('system.outboxSub', { sent: h.outbox.SENT ?? 0, failed: h.outbox.FAILED ?? 0, provider: h.jobs.emailProvider })}
      />
      <Tile label={t('system.mobileMoney')} value={h.mobileMoneyPending} sub={t('system.mobileMoneySub', { seconds: h.jobs.mobileMoneyPollSeconds })} />
    </div>
  );
}

function Database() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['system-database'],
    queryFn: () =>
      api<{
        version: string | null;
        sizeBytes: string | null;
        connections: { state: string; count: string }[];
        tables: { name: string; rows: string; size: string }[];
        migrations: { name: string; finishedAt: string | null; failed: boolean }[] | null;
        longRunning: { pid: number; seconds: number; query: string }[];
      }>('/platform/system/database'),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorMessage error={q.error} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile label={t('system.dbSize')} value={bytes(d.sizeBytes)} sub={d.version?.split(' on ')[0]} />
        <Tile label={t('system.connections')} value={d.connections.reduce((s, c) => s + Number(c.count), 0)} sub={d.connections.map((c) => `${c.state}: ${c.count}`).join(' · ')} />
        <Tile label={t('system.longRunning')} value={d.longRunning.length} tone={d.longRunning.length > 0 ? 'bad' : undefined} sub={t('system.longRunningSub')} />
      </div>
      {d.longRunning.length > 0 && (
        <Card title={t('system.longRunning')}>
          <Table head={['PID', t('system.seconds'), 'SQL']}>
            {d.longRunning.map((r) => (
              <tr key={r.pid}>
                <td className="tabular">{r.pid}</td>
                <td className="tabular">{r.seconds}</td>
                <td className="font-mono text-xs">{r.query}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card title={t('system.tables')}>
        <Table head={[t('system.table'), t('system.rows'), t('system.size')]}>
          {d.tables.map((r) => (
            <tr key={r.name}>
              <td className="font-mono text-xs">{r.name}</td>
              <td className="tabular text-sm">{Number(r.rows).toLocaleString()}</td>
              <td className="tabular text-sm">{bytes(r.size)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title={t('system.migrations')}>
        {d.migrations === null ? (
          <p className="text-sm text-slate-600">{t('system.migrationsHidden')}</p>
        ) : (
          <Table head={[t('system.migration'), t('common.status')]}>
            {d.migrations.map((m) => (
              <tr key={m.name}>
                <td className="font-mono text-xs">{m.name}</td>
                <td>{m.failed ? <Badge tone="red">{t('system.failed')}</Badge> : m.finishedAt ? <Badge tone="green">{new Date(m.finishedAt).toLocaleString()}</Badge> : <Badge>{t('system.rolledBack')}</Badge>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  affected: number | null;
  truncated: boolean;
  ms: number;
}

function SqlConsole() {
  const { t } = useTranslation();
  const mode = useQuery({ queryKey: ['system-sql-mode'], queryFn: () => api<{ writeEnabled: boolean }>('/platform/system/sql') });
  const [sql, setSql] = useState('SELECT slug, legal_name, status, created_at FROM tenants ORDER BY created_at DESC');
  const [confirmation, setConfirmation] = useState('');
  const run = useMutation({ mutationFn: () => api<SqlResult>('/platform/system/sql', { method: 'POST', body: { sql, confirmation: confirmation || undefined } }) });
  const detail = run.error instanceof ApiRequestError && run.error.code === 'SQL_ERROR' ? (run.error.details as { message?: string } | undefined)?.message : null;
  const cell = (v: unknown) => (v === null ? <span className="text-slate-400">NULL</span> : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <Card>
      <p className="mb-3 text-sm text-slate-600">{mode.data?.writeEnabled ? t('system.sqlWriteHelp') : t('system.sqlReadHelp')}</p>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <textarea
          aria-label="SQL"
          rows={6}
          spellCheck={false}
          className="w-full rounded-md border border-slate-300 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run.mutate();
          }}
        />
        <div className="flex flex-wrap items-end gap-3">
          {mode.data?.writeEnabled && (
            <Field label={t('system.sqlConfirm')}>
              <Input className="w-40" value={confirmation} placeholder="CONFIRMER" onChange={(e) => setConfirmation(e.target.value)} />
            </Field>
          )}
          <Button type="submit" disabled={run.isPending || !sql.trim()}>
            {run.isPending ? t('common.loading') : t('system.run')}
          </Button>
          <span className="text-xs text-slate-500">Ctrl+Entrée</span>
        </div>
      </form>
      <div className="mt-3">
        <ErrorMessage error={run.error} />
        {detail && <pre className="mt-2 whitespace-pre-wrap rounded bg-red-50 p-2 font-mono text-xs text-danger-600">{detail}</pre>}
      </div>
      {run.data && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-slate-500">
            {run.data.affected !== null
              ? t('system.affected', { count: run.data.affected, ms: run.data.ms })
              : t('system.rowsReturned', { count: run.data.rows.length, ms: run.data.ms })}
            {run.data.truncated && <> · {t('system.truncated')}</>}
          </p>
          {run.data.rows.length > 0 && (
            <div className="max-h-[32rem] overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    {run.data.columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {run.data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {run.data!.columns.map((c) => (
                        <td key={c} className="max-w-xs truncate whitespace-nowrap px-2 py-1 font-mono" title={String(r[c] ?? '')}>
                          {cell(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Services() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['system-services'],
    queryFn: () => api<{ mounted: boolean; containers: { id: string; name: string; service: string | null; image: string; state: string; status: string }[] }>('/platform/system/services'),
    refetchInterval: REFRESH_MS,
  });
  const [logsOf, setLogsOf] = useState<string | null>(null);
  const logs = useQuery({ queryKey: ['system-logs', logsOf], queryFn: () => api<{ lines: string[] }>(`/platform/system/services/${logsOf}/logs`), enabled: Boolean(logsOf) });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api(`/platform/system/services/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system-services'] }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorMessage error={q.error} />;
  if (!q.data.mounted) return <Card><p className="text-sm text-slate-600">{t('system.dockerNotMounted')}</p></Card>;
  return (
    <Card>
      <Table head={[t('system.container'), t('common.status'), 'Image', '']}>
        {q.data.containers.map((c) => (
          <tr key={c.id}>
            <td>
              <p className="font-medium">{c.service ?? c.name}</p>
              <p className="font-mono text-xs text-slate-500">{c.name}</p>
            </td>
            <td>
              <Badge tone={c.state === 'running' ? 'green' : 'red'}>{c.state}</Badge>
              <p className="text-xs text-slate-500">{c.status}</p>
            </td>
            <td className="font-mono text-xs">{c.image}</td>
            <td className="space-x-1 whitespace-nowrap text-right">
              <Button variant="ghost" onClick={() => setLogsOf(logsOf === c.id ? null : c.id)}>
                {t('system.logs')}
              </Button>
              {(['restart', c.state === 'running' ? 'stop' : 'start'] as const).map((action) => (
                <Button key={action} variant="ghost" disabled={act.isPending} onClick={() => window.confirm(t('system.containerConfirm', { action: t(`system.action.${action}`), name: c.service ?? c.name })) && act.mutate({ id: c.id, action })}>
                  {t(`system.action.${action}`)}
                </Button>
              ))}
            </td>
          </tr>
        ))}
      </Table>
      <ErrorMessage error={act.error} />
      {logsOf && (
        <pre className="mt-4 max-h-96 overflow-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-100">{logs.isPending ? t('common.loading') : (logs.data?.lines.join('\n') ?? '')}</pre>
      )}
    </Card>
  );
}

function Processes() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['system-processes'], queryFn: () => api<{ pid: number; command: string; rss: number; cpuSeconds: number }[]>('/platform/system/processes'), refetchInterval: REFRESH_MS });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorMessage error={q.error} />;
  return (
    <Card>
      <p className="mb-3 text-sm text-slate-600">{t('system.processesHelp')}</p>
      <Table head={['PID', t('system.command'), 'RAM', t('system.cpuTime')]}>
        {q.data.map((p) => (
          <tr key={p.pid}>
            <td className="tabular">{p.pid}</td>
            <td className="max-w-lg truncate font-mono text-xs" title={p.command}>
              {p.command}
            </td>
            <td className="tabular text-sm">{bytes(p.rss)}</td>
            <td className="tabular text-sm">{p.cpuSeconds} s</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Disks() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['system-disks'], queryFn: () => api<{ path: string; total: number; free: number; usedPct: number }[]>('/platform/system/disks') });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorMessage error={q.error} />;
  if (q.data.length === 0) return <Empty>{t('system.noDisk')}</Empty>;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {q.data.map((d) => (
        <Tile key={d.path} label={d.path} value={`${d.usedPct} %`} sub={t('system.freeOf', { free: bytes(d.free), total: bytes(d.total) })}>
          <Meter pct={d.usedPct} />
        </Tile>
      ))}
    </div>
  );
}

function Firewall() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['system-firewall'], queryFn: () => api<{ mounted: boolean; rules: { action: string; proto: string; port: string; destination: string; source: string; direction: string }[] }>('/platform/system/firewall') });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorMessage error={q.error} />;
  if (!q.data.mounted) return <Card><p className="text-sm text-slate-600">{t('system.firewallNotMounted')}</p></Card>;
  return (
    <Card>
      {q.data.rules.length === 0 ? (
        <Empty>{t('system.noRules')}</Empty>
      ) : (
        <Table head={[t('system.ruleAction'), t('system.port'), t('system.protocol'), t('system.source'), t('system.direction')]}>
          {q.data.rules.map((r, i) => (
            <tr key={i}>
              <td>
                <Badge tone={r.action === 'allow' ? 'green' : 'red'}>{r.action}</Badge>
              </td>
              <td className="font-mono text-sm">{r.port}</td>
              <td className="text-sm">{r.proto}</td>
              <td className="font-mono text-xs">{r.source}</td>
              <td className="text-sm">{r.direction}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Analytics() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<{ analytics: AnalyticsSettings }>('/platform/settings') });
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorMessage error={settings.error} />;
  return <AnalyticsForm key={JSON.stringify(settings.data.analytics)} initial={settings.data.analytics} label={t('system.analyticsHelp')} />;
}

function AnalyticsForm({ initial, label }: { initial: AnalyticsSettings; label: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ posthogKey: initial.posthogKey ?? '', posthogHost: initial.posthogHost ?? 'https://eu.i.posthog.com' });
  const save = useMutation({
    mutationFn: () => api('/platform/settings/analytics', { method: 'PUT', body: { posthogKey: f.posthogKey.trim() || null, posthogHost: f.posthogKey.trim() ? f.posthogHost.trim() || null : null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-settings'] });
      void qc.invalidateQueries({ queryKey: ['public-status'] });
    },
  });
  return (
    <Card>
      <p className="mb-3 text-sm text-slate-600">{label}</p>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('system.posthogKey')} hint={t('system.posthogKeyHint')}>
          <Input value={f.posthogKey} placeholder="phc_…" onChange={(e) => setF({ ...f, posthogKey: e.target.value })} />
        </Field>
        <Field label={t('system.posthogHost')}>
          <Input type="url" value={f.posthogHost} onChange={(e) => setF({ ...f, posthogHost: e.target.value })} />
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
