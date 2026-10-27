import type { Tx } from '../prisma/prisma.service';

/**
 * Next value of a per-tenant counter, atomic under concurrency: the upsert takes a row lock,
 * so two registrars creating students at once never receive the same number.
 */
export async function nextCounter(tx: Tx, tenantId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO tenant_counters (tenant_id, key, value) VALUES (${tenantId}::uuid, ${key}, 1)
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + 1
    RETURNING value`;
  return rows[0]!.value;
}
