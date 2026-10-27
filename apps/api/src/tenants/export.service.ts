import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Columns never exported: encrypted credentials stay with the platform (re-entered by the school elsewhere). */
const EXCLUDED_COLUMNS = ['secret_encrypted'];
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Full export of one school's data (spec §11.4 data portability, end of contract).
 * Every table with a `tenant_id` column is included, so tables added later are exported without code changes.
 * Rows are read inside the tenant's RLS scope and serialised by PostgreSQL (`json_agg`), which keeps
 * NUMERIC amounts exact. Users are exported as identity only (no password hash, MFA seed or sessions).
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async export(tenantId: string, actorId: string, ip?: string): Promise<string> {
    return this.prisma.scoped({ tenantId, userId: actorId }, async (tx) => {
      const tables = await tx.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'
        ORDER BY table_name`;
      const parts: string[] = [];
      const counts: Record<string, number> = {};
      for (const { table_name: table } of tables) {
        if (!IDENTIFIER.test(table)) continue;
        const drop = EXCLUDED_COLUMNS.map((c) => ` - '${c}'`).join('');
        const [row] = await tx.$queryRawUnsafe<{ rows: string; n: number }[]>(
          `SELECT coalesce(json_agg(to_jsonb(t)${drop})::text, '[]') AS rows, count(*)::int AS n FROM "${table}" t WHERE t.tenant_id = $1::uuid`,
          tenantId,
        );
        parts.push(`${JSON.stringify(table)}:${row!.rows}`);
        counts[table] = row!.n;
      }
      const [tenant] = await tx.$queryRaw<{ j: string }[]>`
        SELECT to_jsonb(t)::text AS j FROM tenants t WHERE t.id = ${tenantId}::uuid`;
      const [users] = await tx.$queryRaw<{ j: string }[]>`
        SELECT coalesce(json_agg(json_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name, 'locale', u.locale))::text, '[]') AS j
        FROM users u WHERE u.id IN (SELECT user_id FROM user_tenant_memberships WHERE tenant_id = ${tenantId}::uuid)`;
      await this.audit.record({ tenantId, actorId, action: 'tenant.data_exported', metadata: { tables: Object.keys(counts).length, rows: counts }, ip }, tx);
      const meta = { format: 'mboka-tenant-export', version: 1, exportedAt: new Date().toISOString(), counts };
      return `{"meta":${JSON.stringify(meta)},"tenant":${tenant!.j},"users":${users!.j},"tables":{${parts.join(',')}}}`;
    });
  }
}
