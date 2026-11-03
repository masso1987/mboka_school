import { Injectable } from '@nestjs/common';
import { LEGAL_KINDS, maintenanceState, type LegalDocumentInput, type LegalKind, type PlatformMessageInput } from '@mboka/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/api-error';
import { NotificationsService } from '../community/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformActor } from './schools.service';
import { PlatformSettingsService } from './settings.service';

/**
 * What the platform says to everyone (Phase 7): legal documents (versioned, per language), messages to schools
 * (in-app notifications, e-mailed through the notification outbox when mail is configured) and the public status
 * the web app reads before sign-in (maintenance, branding, legal versions).
 */
@Injectable()
export class CommunicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  // ------------------------------------------------------------ public status

  async publicStatus() {
    const { maintenance, branding, analytics } = await this.settings.get();
    const state = maintenanceState(maintenance, new Date());
    return {
      maintenance: {
        ...state,
        message: state.active || state.upcoming ? maintenance.message : '',
        startsAt: maintenance.startsAt,
        endsAt: maintenance.endsAt,
      },
      branding,
      analytics,
      legal: await this.latestVersions(),
    };
  }

  // ------------------------------------------------------------ legal documents

  private async latestVersions() {
    const rows = await this.prisma.legalDocument.groupBy({ by: ['kind', 'locale'], _max: { version: true } });
    return rows.map((r) => ({ kind: r.kind, locale: r.locale, version: r._max.version ?? 0 }));
  }

  /** The current version in the requested language, or in the other one when it has none yet. */
  async publicDocument(kind: string, locale: string) {
    if (!(LEGAL_KINDS as readonly string[]).includes(kind)) throw Errors.notFound('Document');
    const latest = (l: string) => this.prisma.legalDocument.findFirst({ where: { kind, locale: l }, orderBy: { version: 'desc' } });
    const doc = (await latest(locale)) ?? (await latest(locale === 'en' ? 'fr' : 'en'));
    if (!doc) throw Errors.notFound('Document');
    return { kind: doc.kind, locale: doc.locale, version: doc.version, title: doc.title, body: doc.body, publishedAt: doc.publishedAt.toISOString() };
  }

  async legalHistory() {
    const docs = await this.prisma.legalDocument.findMany({ orderBy: [{ kind: 'asc' }, { locale: 'asc' }, { version: 'desc' }] });
    return docs.map((d) => ({ ...d, publishedAt: d.publishedAt.toISOString() }));
  }

  async publishLegal(input: LegalDocumentInput, a: PlatformActor) {
    const last = await this.prisma.legalDocument.findFirst({ where: { kind: input.kind, locale: input.locale }, orderBy: { version: 'desc' }, select: { version: true } });
    const doc = await this.prisma.legalDocument.create({ data: { ...input, version: (last?.version ?? 0) + 1, publishedBy: a.userId } });
    await this.audit.record({ actorId: a.userId, action: 'platform.legal_published', entityType: 'legal_document', entityId: doc.id, metadata: { kind: doc.kind, locale: doc.locale, version: doc.version }, ip: a.ip });
    return { ...doc, publishedAt: doc.publishedAt.toISOString() };
  }

  /** The terms version someone accepts when signing up now, recorded with the sign-up. */
  async currentTermsVersion(locale: string): Promise<number | null> {
    const d = await this.prisma.legalDocument.findFirst({ where: { kind: 'terms' satisfies LegalKind, locale }, orderBy: { version: 'desc' }, select: { version: true } });
    return d?.version ?? null;
  }

  // ------------------------------------------------------------ messages to schools

  async sendMessage(input: PlatformMessageInput, a: PlatformActor) {
    const tenants = input.tenantId
      ? await this.prisma.tenant.findMany({ where: { id: input.tenantId }, select: { id: true } })
      : await this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    if (input.tenantId && tenants.length === 0) throw Errors.notFound('School');
    const adminsOnly = input.audience === 'ALL_ADMINS' || input.audience === 'SCHOOL_ADMINS';
    let recipients = 0;
    for (const t of tenants) {
      recipients += await this.prisma.scoped({ tenantId: t.id, userId: a.userId }, async (tx) => {
        const members = await tx.membership.findMany({
          where: { tenantId: t.id, status: 'ACTIVE', ...(adminsOnly && { assignments: { some: { role: { key: 'director' } } } }) },
          select: { userId: true },
        });
        return this.notifications.notify(tx, t.id, members.map((m) => m.userId), { kind: 'platform.message', title: input.subject, body: input.body });
      });
    }
    const message = await this.prisma.platformMessage.create({ data: { ...input, sentBy: a.userId, recipients } });
    await this.audit.record({ actorId: a.userId, action: 'platform.message_sent', entityType: 'platform_message', entityId: message.id, metadata: { audience: input.audience, tenantId: input.tenantId, recipients }, ip: a.ip });
    return { id: message.id, recipients };
  }

  async messages() {
    const rows = await this.prisma.platformMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const tenantIds = [...new Set(rows.flatMap((r) => (r.tenantId ? [r.tenantId] : [])))];
    const senderIds = [...new Set(rows.map((r) => r.sentBy))];
    const [schools, senders] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, legalName: true } }),
      this.prisma.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, email: true } }),
    ]);
    const school = new Map(schools.map((s) => [s.id, s.legalName]));
    const sender = new Map(senders.map((s) => [s.id, s.email]));
    return rows.map((r) => ({
      id: r.id,
      audience: r.audience,
      school: r.tenantId ? (school.get(r.tenantId) ?? null) : null,
      subject: r.subject,
      body: r.body,
      recipients: r.recipients,
      sentBy: sender.get(r.sentBy) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
