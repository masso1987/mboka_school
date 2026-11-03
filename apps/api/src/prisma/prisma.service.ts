import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface DbScope {
  tenantId?: string | null;
  userId?: string | null;
}

@Injectable()
export class PrismaService extends PrismaClient<Prisma.PrismaClientOptions, 'query'> implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Database');

  constructor() {
    const threshold = Number(process.env.SLOW_QUERY_MS ?? 500);
    // 0 turns slow-query logging off (and the per-query event it costs).
    super(threshold > 0 ? { log: [{ emit: 'event', level: 'query' }] } : {});
    // Slow queries are logged with their SQL text only; parameter values may hold personal data.
    if (threshold > 0) this.$on('query', (e) => {
      if (e.duration >= threshold) this.logger.warn(JSON.stringify({ slowQueryMs: e.duration, sql: e.query.slice(0, 500) }));
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` in a transaction whose Row-Level Security context is `scope`.
   * All access to tenant-owned tables must go through here: outside it, RLS
   * policies see no tenant and return no rows. Services still filter by
   * tenantId explicitly — RLS is the safety net, not the only control.
   */
  /** The one cross-tenant read of report cards: exact verification code only (migration 0006). */
  async reportCardVerification(code: string) {
    if (!/^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code)) return null;
    const rows = await this.$queryRaw<{ status: string; version: number; content: unknown; published_at: Date | null }[]>`
      SELECT * FROM verify_report_card(${code})`;
    const r = rows[0];
    return r ? { status: r.status, version: r.version, content: r.content, publishedAt: r.published_at } : null;
  }

  /**
   * Read-only access to every tenant's rows for the platform console (migration 0013). Only for routes behind
   * @PlatformAdmin(); writes to a school still go through `scoped({ tenantId })`.
   */
  platform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.platform', 'on', true)`;
      return fn(tx);
    });
  }

  /** `timeoutMs` raises Prisma's 5-second limit for the rare long transaction (building a demo school). */
  scoped<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>, timeoutMs?: number): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${scope.tenantId ?? ''}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`;
        return fn(tx);
      },
      timeoutMs ? { timeout: timeoutMs, maxWait: 10_000 } : undefined,
    );
  }
}
