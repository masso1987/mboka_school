import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface DbScope {
  tenantId?: string | null;
  userId?: string | null;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
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
  scoped<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${scope.tenantId ?? ''}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`;
      return fn(tx);
    });
  }
}
