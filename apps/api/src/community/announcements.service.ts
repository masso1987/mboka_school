import { Injectable } from '@nestjs/common';
import type { AnnouncementInput } from '@mboka/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { Errors } from '../common/api-error';
import { toDate } from '../common/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { audienceUsers, identityOf } from './audience';
import { NotificationsService } from './notifications.service';

/** School announcements targeted by audience, with an in-app notification per recipient (COM-002/003). */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  publish(a: Actor, input: AnnouncementInput) {
    return this.run(a, async (tx) => {
      if (input.classId && !(await tx.schoolClass.findFirst({ where: { id: input.classId, tenantId: a.tenantId }, select: { id: true } }))) {
        throw Errors.notFound('Class');
      }
      const ann = await tx.announcement.create({
        data: {
          tenantId: a.tenantId,
          title: input.title,
          body: input.body,
          audience: input.audience,
          classId: input.classId,
          authorId: a.userId,
          expiresAt: input.expiresAt ? toDate(input.expiresAt) : undefined,
        },
      });
      const recipients = (await audienceUsers(tx, a.tenantId, input.audience, input.classId ?? null)).filter((u) => u !== a.userId);
      const notified = await this.notifications.notify(tx, a.tenantId, recipients, {
        kind: 'announcement',
        title: input.title,
        body: input.body.slice(0, 280),
        link: '/community',
        dedupeKey: `announcement:${ann.id}`,
      });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'announcement.published', entityType: 'announcement', entityId: ann.id, metadata: { audience: input.audience, classId: input.classId ?? null, recipients: notified }, ip: a.ip },
        tx,
      );
      return { id: ann.id, recipients: notified };
    });
  }

  /**
   * What the signed-in member may read: everything for publishers; otherwise ALL, plus STAFF for
   * staff, GUARDIANS for parents, STUDENTS for students, and CLASS for their (children's) classes.
   */
  feed(a: Actor) {
    return this.run(a, async (tx) => {
      const me = await identityOf(tx, a.tenantId, a.membershipId);
      const now = new Date();
      const visible: Prisma.AnnouncementWhereInput[] = a.permissions.has('announcements.publish')
        ? [{}]
        : [
            { audience: 'ALL' },
            ...(me.isStaff ? [{ audience: 'STAFF' as const }] : []),
            ...(me.guardianId ? [{ audience: 'GUARDIANS' as const }] : []),
            ...(me.studentId ? [{ audience: 'STUDENTS' as const }] : []),
            ...(me.classIds.length ? [{ audience: 'CLASS' as const, classId: { in: me.classIds } }] : []),
          ];
      const rows = await tx.announcement.findMany({
        where: { tenantId: a.tenantId, OR: visible, AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }] },
        orderBy: { publishedAt: 'desc' },
        take: 50,
      });
      const classes = await tx.schoolClass.findMany({ where: { tenantId: a.tenantId, id: { in: rows.flatMap((r) => (r.classId ? [r.classId] : [])) } }, select: { id: true, name: true } });
      const authors = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, fullName: true } });
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        audience: r.audience,
        class: classes.find((c) => c.id === r.classId) ?? null,
        author: authors.find((u) => u.id === r.authorId)?.fullName ?? null,
        publishedAt: r.publishedAt.toISOString(),
        canDelete: r.authorId === a.userId || a.permissions.has('announcements.publish'),
      }));
    });
  }

  remove(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const ann = await tx.announcement.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!ann) throw Errors.notFound('Announcement');
      await tx.announcement.delete({ where: { id } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'announcement.deleted', entityType: 'announcement', entityId: id, metadata: { title: ann.title }, ip: a.ip }, tx);
    });
  }
}
