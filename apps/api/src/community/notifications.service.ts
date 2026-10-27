import { Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../common/actor';
import { Errors } from '../common/api-error';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export interface NotificationDraft {
  kind: string;
  title: string;
  body: string;
  link?: string;
  /** Same key + user = sent once (absence alerts, published report cards). */
  dedupeKey?: string;
}

/**
 * In-app notifications with read status, and an outbox of email deliveries (COM-004…008).
 * Creating a notification is distinct from delivering it: deliveries carry their own status,
 * attempts and last error, and failures can be retried.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(private readonly prisma: PrismaService) {}

  /** Creates one notification per user inside the caller's transaction, plus a pending email delivery. */
  async notify(tx: Tx, tenantId: string, userIds: string[], draft: NotificationDraft): Promise<number> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return 0;
    const users = await tx.user.findMany({ where: { id: { in: unique }, isActive: true }, select: { id: true, email: true } });
    let created = 0;
    for (const u of users) {
      if (draft.dedupeKey) {
        const exists = await tx.notification.findUnique({
          where: { tenantId_userId_dedupeKey: { tenantId, userId: u.id, dedupeKey: draft.dedupeKey } },
          select: { id: true },
        });
        if (exists) continue;
      }
      await tx.notification.create({
        data: {
          tenantId,
          userId: u.id,
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          link: draft.link,
          dedupeKey: draft.dedupeKey,
          deliveries: { create: [{ channel: 'EMAIL', destination: u.email }] },
        },
      });
      created++;
    }
    return created;
  }

  /** Users holding a parent account for any of these students. */
  async guardianUsers(tx: Tx, tenantId: string, studentIds: string[]): Promise<{ studentId: string; userId: string }[]> {
    const links = await tx.studentGuardian.findMany({
      where: { tenantId, studentId: { in: studentIds }, guardian: { membershipId: { not: null } } },
      select: { studentId: true, guardian: { select: { membershipId: true } } },
    });
    const memberships = await tx.membership.findMany({
      where: { tenantId, status: 'ACTIVE', id: { in: links.map((l) => l.guardian.membershipId!) } },
      select: { id: true, userId: true },
    });
    const userOf = new Map(memberships.map((m) => [m.id, m.userId]));
    return links.flatMap((l) => {
      const userId = userOf.get(l.guardian.membershipId!);
      return userId ? [{ studentId: l.studentId, userId }] : [];
    });
  }

  /** Absence alert to linked parents, at most once per student and day (ATT-006, COM-004). */
  async notifyAbsences(tx: Tx, tenantId: string, className: string, date: string, students: { id: string; name: string }[]) {
    if (students.length === 0) return;
    const recipients = await this.guardianUsers(tx, tenantId, students.map((s) => s.id));
    for (const s of students) {
      await this.notify(
        tx,
        tenantId,
        recipients.filter((r) => r.studentId === s.id).map((r) => r.userId),
        {
          kind: 'attendance.absence',
          title: `Absence — ${s.name}`,
          body: `${s.name} a été noté(e) absent(e) le ${date} (${className}).`,
          link: `/portal/children/${s.id}`,
          dedupeKey: `absence:${s.id}:${date}`,
        },
      );
    }
  }

  // ------------------------------------------------------------ the signed-in user's inbox

  mine(a: Actor, unreadOnly: boolean) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, async (tx) => {
      const [items, unread] = await Promise.all([
        tx.notification.findMany({
          where: { tenantId: a.tenantId, userId: a.userId, ...(unreadOnly && { readAt: null }) },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { deliveries: { select: { channel: true, status: true } } },
        }),
        tx.notification.count({ where: { tenantId: a.tenantId, userId: a.userId, readAt: null } }),
      ]);
      return {
        unread,
        items: items.map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          link: n.link,
          read: n.readAt !== null,
          createdAt: n.createdAt.toISOString(),
          deliveries: n.deliveries,
        })),
      };
    });
  }

  markRead(a: Actor, id: string | 'all') {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, async (tx) => {
      const { count } = await tx.notification.updateMany({
        where: { tenantId: a.tenantId, userId: a.userId, readAt: null, ...(id !== 'all' && { id }) },
        data: { readAt: new Date() },
      });
      if (id !== 'all' && count === 0) {
        const exists = await tx.notification.count({ where: { tenantId: a.tenantId, userId: a.userId, id } });
        if (!exists) throw Errors.notFound('Notification');
      }
      return { marked: count };
    });
  }

  // ------------------------------------------------------------ delivery outbox

  deliveries(a: Actor, status?: string) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, async (tx) => {
      const rows = await tx.notificationDelivery.findMany({
        where: { tenantId: a.tenantId, ...(status && { status: status as 'PENDING' }) },
        include: { notification: { select: { title: true, kind: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const counts = await tx.notificationDelivery.groupBy({ by: ['status'], where: { tenantId: a.tenantId }, _count: { _all: true } });
      return {
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
        items: rows.map((d) => ({
          id: d.id,
          channel: d.channel,
          destination: maskEmail(d.destination),
          status: d.status,
          attempts: d.attempts,
          lastError: d.lastError,
          title: d.notification.title,
          createdAt: d.createdAt.toISOString(),
          sentAt: d.sentAt?.toISOString() ?? null,
        })),
      };
    });
  }

  /**
   * Sends pending deliveries through the configured provider. EMAIL_PROVIDER=log (development)
   * logs and marks them sent; with no provider configured they fail visibly with NO_EMAIL_PROVIDER
   * and can be retried once one is set up (COM-006, Module 12 AC).
   */
  process(a: Actor) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, async (tx) => {
      const pending = await tx.notificationDelivery.findMany({ where: { tenantId: a.tenantId, status: 'PENDING' }, take: 200, include: { notification: true } });
      const provider = process.env.EMAIL_PROVIDER;
      let sent = 0;
      let failed = 0;
      for (const d of pending) {
        if (provider === 'log') {
          this.logger.log(`[email:log] to=${maskEmail(d.destination)} subject="${d.notification.title}"`);
          await tx.notificationDelivery.update({ where: { id: d.id }, data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), lastError: null } });
          sent++;
        } else {
          await tx.notificationDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: 'NO_EMAIL_PROVIDER' } });
          failed++;
        }
      }
      return { processed: pending.length, sent, failed };
    });
  }

  retry(a: Actor, id: string) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, async (tx) => {
      const { count } = await tx.notificationDelivery.updateMany({ where: { tenantId: a.tenantId, id, status: 'FAILED' }, data: { status: 'PENDING' } });
      if (count === 0) throw Errors.conflict('NOT_RETRYABLE', 'Only failed deliveries can be retried');
      return { id, status: 'PENDING' as const };
    });
  }
}

/** Delivery lists never show full addresses to administrators. */
function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

