import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export interface AuditEntry {
  tenantId?: string | null;
  actorId?: string | null;
  /** Dotted verb, e.g. `auth.login.failed`, `academic_year.created`. */
  action: string;
  entityType?: string;
  entityId?: string;
  /** Before/after or context. Never put secrets, tokens or passwords here. */
  metadata?: Prisma.InputJsonValue;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pass the transaction client when auditing a change so the audit row commits
   * or rolls back with it. Without `tx`, only platform events (no tenant) can be written.
   */
  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma;
    // createMany issues a plain INSERT (no RETURNING): platform rows are deliberately
    // not readable by the runtime role, and RLS checks SELECT policies on returned rows.
    await db.auditLog.createMany({
      data: {
        tenantId: entry.tenantId ?? null,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata ?? {},
        ip: entry.ip,
      },
    });
  }
}
