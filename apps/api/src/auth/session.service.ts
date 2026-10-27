import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../common/request-context';

export const SESSION_COOKIE = 'mboka_sid';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, meta: { ip?: string; userAgent?: string }) {
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
      },
    });
    return { token, csrfToken, expiresAt, sessionId: session.id };
  }

  /** Resolves a raw cookie token to an auth context, or null if invalid, expired, revoked or the user is disabled. */
  async resolve(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, email: true, platformRole: true, isActive: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) return null;
    return {
      userId: session.user.id,
      sessionId: session.id,
      email: session.user.email,
      platformRole: session.user.platformRole,
      csrfToken: session.csrfToken,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
