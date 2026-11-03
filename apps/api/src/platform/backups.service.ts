import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { AuditService } from '../audit/audit.service';
import { ApiException, Errors } from '../common/api-error';
import { opensslEncrypt } from '../common/openssl-enc';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from '../tenants/export.service';
import type { PlatformActor } from './schools.service';

/** Whole-database backups as scripts/backup.sh names them. */
const BACKUP_FILE = /^mboka-\d{8}T\d{6}Z\.dump\.enc$/;
const REQUEST_ID = /^[0-9a-f-]{36}$/;
/** The agent writes its heartbeat at least every 30 s; older than this, it is considered stopped. */
const AGENT_STALE_MS = 2 * 60_000;

/**
 * Backups (Phase 7).
 * - A school: its complete export (every row of every school table, users without secrets), gzipped and encrypted
 *   with a password chosen at download, openssl-compatible. Built by the API; never stored on the server.
 * - The whole database: the API never holds the database owner's password. It drops a request in BACKUP_DIR; the
 *   backup-agent container (deploy/backup-agent.sh, owner credentials) runs scripts/backup.sh or restore-test.sh and
 *   writes the outcome next to it. The console lists, downloads (encrypted as written) and follows requests.
 * Restoring the live database stays a command on the server (operations §6).
 */
@Injectable()
export class BackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly exporter: ExportService,
  ) {}

  private dir() {
    return process.env.BACKUP_DIR ?? '/backups';
  }

  private requests() {
    return join(this.dir(), 'requests');
  }

  // ------------------------------------------------------------ one school

  async schoolBackup(tenantId: string, password: string, a: PlatformActor) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    if (!tenant) throw Errors.notFound('School');
    const json = await this.exporter.export(tenantId, a.userId, a.ip);
    const file = opensslEncrypt(gzipSync(Buffer.from(json, 'utf8')), password);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    await this.prisma.scoped({ tenantId, userId: a.userId }, (tx) =>
      this.audit.record({ tenantId, actorId: a.userId, action: 'platform.school_backup', entityType: 'tenant', entityId: tenantId, metadata: { bytes: file.length }, ip: a.ip }, tx),
    );
    return { filename: `ecole-${tenant.slug}-${stamp}.json.gz.enc`, file };
  }

  // ------------------------------------------------------------ whole database

  private async agent() {
    try {
      const at = (await fs.readFile(join(this.dir(), 'agent.heartbeat'), 'utf8')).trim();
      return { running: Date.now() - new Date(at).getTime() < AGENT_STALE_MS, lastSeen: at };
    } catch {
      return { running: false, lastSeen: null };
    }
  }

  async list() {
    const dir = this.dir();
    const agent = await this.agent();
    if (!existsSync(dir)) return { configured: false, agent, backups: [], requests: [] };
    const names = await fs.readdir(dir);
    const backups = [];
    for (const name of names.filter((n) => BACKUP_FILE.test(n))) {
      const st = await fs.stat(join(dir, name));
      backups.push({ name, bytes: st.size, createdAt: st.mtime.toISOString(), checksum: names.includes(`${name}.sha256`) });
    }
    backups.sort((x, y) => y.name.localeCompare(x.name));
    return { configured: true, agent, backups, requests: await this.recentRequests() };
  }

  /** Requests and their outcome: <id>.<kind> waiting, <id>.running, then <id>.log and <id>.exit when done. */
  private async recentRequests() {
    const dir = this.requests();
    if (!existsSync(dir)) return [];
    const names = await fs.readdir(dir);
    const ids = [...new Set(names.map((n) => n.split('.')[0]!).filter((id) => REQUEST_ID.test(id)))];
    const out = [];
    for (const id of ids) out.push(await this.request(id));
    return out.sort((x, y) => (y.requestedAt ?? '').localeCompare(x.requestedAt ?? '')).slice(0, 20);
  }

  async request(id: string) {
    if (!REQUEST_ID.test(id)) throw Errors.notFound('Request');
    const dir = this.requests();
    const read = (ext: string) => fs.readFile(join(dir, `${id}.${ext}`), 'utf8').catch(() => null);
    const [meta, exit, log] = await Promise.all([read('json'), read('exit'), read('log')]);
    if (!meta) throw Errors.notFound('Request');
    const m = JSON.parse(meta) as { kind: string; file?: string; requestedAt: string; by: string };
    const running = existsSync(join(dir, `${id}.running`));
    const status = exit !== null ? (exit.trim() === '0' ? 'DONE' : 'FAILED') : running ? 'RUNNING' : 'WAITING';
    return { id, kind: m.kind, file: m.file ?? null, requestedAt: m.requestedAt, by: m.by, status, output: log?.slice(-4000) ?? null };
  }

  private async enqueue(kind: 'backup' | 'restore', a: PlatformActor, file?: string) {
    const dir = this.requests();
    if (!existsSync(this.dir())) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'BACKUPS_NOT_CONFIGURED', 'The backups folder is not mounted for the API');
    await fs.mkdir(dir, { recursive: true });
    const id = randomUUID();
    const by = (await this.prisma.user.findUnique({ where: { id: a.userId }, select: { email: true } }))?.email ?? a.userId;
    await fs.writeFile(join(dir, `${id}.json`), JSON.stringify({ kind, file, requestedAt: new Date().toISOString(), by }));
    // The trigger file is written last: the agent never sees a request without its details.
    await fs.writeFile(join(dir, `${id}.${kind}`), file ?? '');
    await this.audit.record({ actorId: a.userId, action: kind === 'backup' ? 'platform.backup_requested' : 'platform.restore_test_requested', metadata: { requestId: id, file: file ?? null }, ip: a.ip });
    return { id, status: 'WAITING' as const, agent: await this.agent() };
  }

  runBackup(a: PlatformActor) {
    return this.enqueue('backup', a);
  }

  async runRestoreTest(name: string, a: PlatformActor) {
    await this.backupPath(name);
    return this.enqueue('restore', a, name);
  }

  private async backupPath(name: string) {
    if (!BACKUP_FILE.test(name)) throw Errors.notFound('Backup');
    const path = join(this.dir(), name);
    if (!existsSync(path)) throw Errors.notFound('Backup');
    return path;
  }

  /** The encrypted file as written by backup.sh; it is useless without BACKUP_PASSPHRASE. */
  async download(name: string, a: PlatformActor) {
    const path = await this.backupPath(name);
    const { size } = await fs.stat(path);
    await this.audit.record({ actorId: a.userId, action: 'platform.backup_downloaded', metadata: { file: name, bytes: size }, ip: a.ip });
    return { stream: createReadStream(path), size };
  }
}
