import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { existsSync, promises as fs } from 'node:fs';
import { request } from 'node:http';
import os from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { AuditService } from '../audit/audit.service';
import { ApiException, Errors } from '../common/api-error';
import { metrics } from '../common/observability';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformActor } from './schools.service';
import { checkSql, SQL_ROW_CAP } from './sql-guard';

const DOCKER_SOCKET = '/var/run/docker.sock';
const UFW_RULES = '/host/etc/ufw/user.rules';
/** Typed by the administrator to confirm a statement that changes data (write mode only). */
export const SQL_WRITE_CONFIRMATION = 'CONFIRMER';
const SQL_TIMEOUT_MS = 10_000;

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

/** Database values made JSON-safe for the console (bigint, Decimal, dates, bytes). */
function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Prisma.Decimal) return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `\\x${Buffer.from(v).toString('hex').slice(0, 200)}`;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

/** Calls the Docker Engine API over its socket (only when deploy/docker-compose.sysops.yml mounts it). */
function docker(path: string, method = 'GET'): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: DOCKER_SOCKET, path, method, timeout: 10_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('docker timeout')));
    req.end();
  });
}

/** Container logs come multiplexed (8-byte frame headers) unless the container has a TTY. */
function demuxLogs(buf: Buffer): string {
  const out: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length && (buf[i] === 1 || buf[i] === 2) && buf[i + 1] === 0) {
    const size = buf.readUInt32BE(i + 4);
    out.push(buf.subarray(i + 8, i + 8 + size).toString('utf8'));
    i += 8 + size;
  }
  return i === 0 ? buf.toString('utf8') : out.join('');
}

/**
 * Platform console → System & database (Phase 7): live health of the API process, the host and PostgreSQL, a
 * guarded SQL console, and — when the operator mounts them — the stack's containers and the host firewall rules.
 */
@Injectable()
export class SystemService {
  private cpu = { usage: process.cpuUsage(), at: performance.now() };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async dbLatencyMs(): Promise<number | null> {
    const t0 = performance.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return Math.round((performance.now() - t0) * 10) / 10;
    } catch {
      return null;
    }
  }

  private async disk(path = '/') {
    try {
      const s = await fs.statfs(path);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      return { path, total, free, usedPct: total ? Math.round(((total - free) / total) * 1000) / 10 : 0 };
    } catch {
      return null;
    }
  }

  /** CPU used by this process since the previous call, as a share of every core. */
  private cpuPct() {
    const now = performance.now();
    const usage = process.cpuUsage(this.cpu.usage);
    const elapsedUs = (now - this.cpu.at) * 1000;
    this.cpu = { usage: process.cpuUsage(), at: now };
    return elapsedUs > 0 ? Math.round(((usage.user + usage.system) / elapsedUs / os.cpus().length) * 1000) / 10 : 0;
  }

  async overview() {
    const [dbMs, disk] = await Promise.all([this.dbLatencyMs(), this.disk()]);
    const memory = { total: os.totalmem(), free: os.freemem() };
    const memoryPct = Math.round(((memory.total - memory.free) / memory.total) * 1000) / 10;
    const requests = metrics.recent();
    const alerts: { kind: string; value?: number }[] = [];
    if (dbMs === null) alerts.push({ kind: 'DATABASE_DOWN' });
    else if (dbMs > 200) alerts.push({ kind: 'DATABASE_SLOW', value: dbMs });
    if (disk && disk.usedPct >= 90) alerts.push({ kind: 'DISK_FULL', value: disk.usedPct });
    if (memoryPct >= 90) alerts.push({ kind: 'MEMORY_HIGH', value: memoryPct });
    if (requests.errors5xx > 0) alerts.push({ kind: 'SERVER_ERRORS', value: requests.errors5xx });
    return {
      app: { up: true, uptimeSeconds: Math.round(process.uptime()) },
      database: { up: dbMs !== null, latencyMs: dbMs },
      disk,
      memory: { ...memory, usedPct: memoryPct },
      cpu: { processPct: this.cpuPct(), load: os.loadavg(), cores: os.cpus().length },
      requests,
      alerts,
      server: {
        hostname: os.hostname(),
        system: `${os.type()} ${os.release()}`,
        uptimeSeconds: Math.round(os.uptime()),
        node: process.version,
        rss: process.memoryUsage().rss,
        release: process.env.RELEASE ?? 'dev',
        docker: existsSync(DOCKER_SOCKET),
      },
    };
  }

  async health() {
    const mem = process.memoryUsage();
    const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;
    const counts = await this.prisma.platform(async (tx) => ({
      outbox: await tx.notificationDelivery.groupBy({ by: ['status'], _count: true }),
      mobileMoneyPending: await tx.payment.count({ where: { status: 'PENDING_VERIFICATION', provider: { not: null } } }),
    }));
    return {
      eventLoop: { meanMs: ms(loop.mean), p99Ms: ms(loop.percentile(99)), maxMs: ms(loop.max) },
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external },
      outbox: Object.fromEntries(counts.outbox.map((o) => [o.status, o._count])),
      mobileMoneyPending: counts.mobileMoneyPending,
      jobs: {
        mobileMoneyPollSeconds: Number(process.env.MOBILE_MONEY_POLL_SECONDS ?? 60),
        demoSweepMinutes: Number(process.env.DEMO_SWEEP_MINUTES ?? 60),
        emailProvider: process.env.EMAIL_PROVIDER || 'log',
      },
    };
  }

  async database() {
    const q = <T>(sql: Prisma.Sql) => this.prisma.$queryRaw<T>(sql).catch(() => null);
    const [version, size, connections, tables, migrations, longRunning] = await Promise.all([
      q<{ version: string }[]>(Prisma.sql`SELECT version()`),
      q<{ size: bigint }[]>(Prisma.sql`SELECT pg_database_size(current_database()) AS size`),
      q<{ state: string | null; count: bigint }[]>(Prisma.sql`SELECT state, count(*) AS count FROM pg_stat_activity WHERE datname = current_database() GROUP BY state`),
      q<{ name: string; rows: bigint; size: bigint }[]>(Prisma.sql`SELECT relname AS name, n_live_tup AS rows, pg_total_relation_size(relid) AS size FROM pg_stat_user_tables ORDER BY size DESC`),
      q<{ name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>(
        Prisma.sql`SELECT migration_name AS name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 20`,
      ),
      q<{ pid: number; seconds: number; query: string }[]>(
        Prisma.sql`SELECT pid, extract(epoch FROM now() - query_start)::int AS seconds, left(query, 300) AS query FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND now() - query_start > interval '5 seconds' ORDER BY query_start`,
      ),
    ]);
    return plain({
      version: version?.[0]?.version ?? null,
      sizeBytes: size?.[0]?.size ?? null,
      connections: connections?.map((c) => ({ state: c.state ?? 'background', count: c.count })) ?? [],
      tables: tables ?? [],
      // Null when the runtime role may not read the migration table (production keeps it to the owner).
      migrations: migrations?.map((m) => ({ name: m.name, finishedAt: m.finished_at, failed: !m.finished_at && !m.rolled_back_at })) ?? null,
      longRunning: longRunning ?? [],
    });
  }

  // ------------------------------------------------------------ SQL console

  writeEnabled() {
    return process.env.CONSOLE_SQL_WRITE === '1';
  }

  /**
   * Runs one statement as the API's runtime role, reading across schools through the platform scope, inside a
   * READ ONLY transaction with a 10-second timeout. Writes need CONSOLE_SQL_WRITE=1 on the server and the typed
   * confirmation; row-level security still applies to them. Every statement is audited, refused or not.
   */
  async sql(input: string, confirmation: string | undefined, a: PlatformActor) {
    const check = checkSql(input, this.writeEnabled());
    const record = (outcome: Record<string, unknown>) =>
      this.audit.record({ actorId: a.userId, action: 'platform.sql_executed', metadata: { sql: input.slice(0, 2000), ...outcome } as Prisma.InputJsonObject, ip: a.ip });
    if (!check.ok) {
      await record({ refused: check.code });
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, check.code, 'This statement is not allowed in the console');
    }
    if (!check.readOnly && confirmation !== SQL_WRITE_CONFIRMATION) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'SQL_CONFIRMATION_REQUIRED', `Type ${SQL_WRITE_CONFIRMATION} to run a statement that changes data`);
    }
    const t0 = performance.now();
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          if (check.readOnly) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${SQL_TIMEOUT_MS}`);
          await tx.$queryRaw`SELECT set_config('app.platform', 'on', true)`;
          if (!check.readOnly) return { affected: await tx.$executeRawUnsafe(check.sql) };
          return { rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(check.sql) };
        },
        { timeout: SQL_TIMEOUT_MS + 5_000 },
      );
      const ms = Math.round(performance.now() - t0);
      if ('affected' in result) {
        await record({ write: true, affected: result.affected, ms });
        return { columns: [], rows: [], affected: result.affected, truncated: false, ms };
      }
      const truncated = check.capped && result.rows.length > SQL_ROW_CAP;
      const rows = (truncated ? result.rows.slice(0, SQL_ROW_CAP) : result.rows).map((r) => plain(r) as Record<string, unknown>);
      await record({ rows: rows.length, truncated, ms });
      return { columns: rows[0] ? Object.keys(rows[0]) : [], rows, affected: null, truncated, ms };
    } catch (e) {
      const message = e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError ? e.message.split('\n').filter(Boolean).pop() : String(e);
      await record({ error: message?.slice(0, 500) });
      throw new ApiException(HttpStatus.BAD_REQUEST, 'SQL_ERROR', 'The database refused the statement', { message });
    }
  }

  // ------------------------------------------------------------ processes and disk

  async processes() {
    if (process.platform !== 'linux') {
      return [{ pid: process.pid, command: process.argv.join(' ').slice(0, 300), rss: process.memoryUsage().rss, cpuSeconds: Math.round(process.cpuUsage().user / 1e6) }];
    }
    const page = 4096;
    const ticks = 100;
    const pids = (await fs.readdir('/proc')).filter((p) => /^\d+$/.test(p));
    const rows = [];
    for (const pid of pids) {
      try {
        const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const cmd = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/g, ' ').trim();
        rows.push({
          pid: Number(pid),
          command: (cmd || stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'))).slice(0, 300),
          rss: Number(fields[21]) * page,
          cpuSeconds: Math.round((Number(fields[11]) + Number(fields[12])) / ticks),
        });
      } catch {
        // The process ended while being read.
      }
    }
    return rows.sort((x, y) => y.rss - x.rss);
  }

  async disks() {
    const paths = ['/', '/tmp', process.env.BACKUP_DIR ?? '/backups'].filter((p, i, all) => all.indexOf(p) === i);
    const out = [];
    for (const p of paths) if (existsSync(p)) out.push(await this.disk(p));
    return out.filter(Boolean);
  }

  // ------------------------------------------------------------ containers and firewall (optional mounts)

  private requireDocker() {
    if (!existsSync(DOCKER_SOCKET)) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'DOCKER_NOT_MOUNTED', 'The Docker socket is not mounted (deploy/docker-compose.sysops.yml)');
  }

  private projectFilter() {
    if (process.env.SYSOPS_DOCKER_ALL === '1') return '';
    const project = process.env.COMPOSE_PROJECT_NAME ?? 'mboka-school';
    return `&filters=${encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${project}`] }))}`;
  }

  async services() {
    if (!existsSync(DOCKER_SOCKET)) return { mounted: false, containers: [] };
    const res = await docker(`/containers/json?all=1${this.projectFilter()}`);
    const list = JSON.parse(res.body.toString('utf8')) as { Id: string; Names: string[]; Image: string; State: string; Status: string; Labels: Record<string, string> }[];
    return {
      mounted: true,
      containers: list.map((c) => ({ id: c.Id.slice(0, 12), name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12), service: c.Labels['com.docker.compose.service'] ?? null, image: c.Image, state: c.State, status: c.Status })),
    };
  }

  private async containerOrThrow(id: string) {
    this.requireDocker();
    const { containers } = await this.services();
    const c = containers.find((x) => x.id === id);
    if (!c) throw Errors.notFound('Container');
    return c;
  }

  async containerAction(id: string, action: 'start' | 'stop' | 'restart', a: PlatformActor) {
    const c = await this.containerOrThrow(id);
    const res = await docker(`/containers/${id}/${action}?t=10`, 'POST');
    await this.audit.record({ actorId: a.userId, action: 'platform.container_action', metadata: { container: c.name, action, status: res.status }, ip: a.ip });
    if (res.status >= 400) throw new ApiException(HttpStatus.BAD_GATEWAY, 'DOCKER_ERROR', res.body.toString('utf8').slice(0, 300));
    return { id, action, done: true };
  }

  async containerLogs(id: string) {
    await this.containerOrThrow(id);
    const res = await docker(`/containers/${id}/logs?stdout=1&stderr=1&tail=200&timestamps=1`);
    return { lines: demuxLogs(res.body).split('\n').filter(Boolean).slice(-200) };
  }

  /** Allowed ports and sources from the host's ufw rules (read-only mount of /etc/ufw). */
  async firewall() {
    if (!existsSync(UFW_RULES)) return { mounted: false, rules: [] };
    const text = await fs.readFile(UFW_RULES, 'utf8');
    const rules = text
      .split('\n')
      .filter((l) => l.startsWith('### tuple ###'))
      .map((l) => {
        const [action, proto, port, dest, src, direction] = l.replace('### tuple ###', '').trim().split(/\s+/);
        return { action, proto, port, destination: dest, source: src, direction: direction ?? 'in' };
      });
    return { mounted: true, rules };
  }
}
