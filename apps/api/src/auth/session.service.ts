import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../common/request-context';

export const SESSION_COOKIE = 'mboka_sid';

/** lastSeenAt is refreshed at most this often, to keep reads cheap. */
const SEEN_RESOLUTION_MS = 5 * 60_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** `mfaVerified: false` opens a half session that only allows the second login step. */
  async create(userId: string, meta: { ip?: string; userAgent?: string; mfaVerified?: boolean }) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        csrfToken,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
        expiresAt,
        mfaVerified: meta.mfaVerified ?? true,
        lastSeenAt: new Date(),
      },
    });
    return { token, csrfToken, expiresAt, sessionId: session.id };
  }

  /** Resolves a raw cookie token to an auth context, or null if invalid, expired, revoked or the user is disabled. */
  async resolve(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, email: true, platformRole: true, isActive: true, mfaEnabledAt: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) return null;
    if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > SEEN_RESOLUTION_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return {
      userId: session.user.id,
      sessionId: session.id,
      email: session.user.email,
      platformRole: session.user.platformRole,
      csrfToken: session.csrfToken,
      mfaVerified: session.mfaVerified,
      mfaEnabled: session.user.mfaEnabledAt !== null,
    };
  }

  async markMfaVerified(sessionId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId && { id: { not: exceptSessionId } }) },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** The user's active sessions, for the account page (never exposes tokens). */
  async list(userId: string, currentSessionId: string) {
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      current: r.id === currentSessionId,
    }));
  }
}
