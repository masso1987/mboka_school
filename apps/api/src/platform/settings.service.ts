import { CanActivate, ExecutionContext, Global, HttpStatus, Injectable, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  DEFAULT_ANALYTICS,
  DEFAULT_BRANDING,
  DEFAULT_MAINTENANCE,
  maintenanceState,
  type AnalyticsSettings,
  type BrandingSettings,
  type MaintenanceSettings,
  type SecuritySettings,
} from '@mboka/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { IS_PUBLIC } from '../auth/metadata';
import { ApiException } from '../common/api-error';
import type { AppRequest } from '../common/request-context';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface PlatformSettings {
  maintenance: MaintenanceSettings;
  security: SecuritySettings;
  branding: BrandingSettings;
  analytics: AnalyticsSettings;
}

/** Settings are read on every request (maintenance, session timeouts): keep them this long in memory. */
const CACHE_MS = 10_000;

/**
 * Platform settings (Phase 7): maintenance, session timeouts and branding, one database row read through a
 * short cache. A change applies on this API instance at once and on others within CACHE_MS.
 */
@Injectable()
export class PlatformSettingsService {
  private cache?: { at: number; value: PlatformSettings };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.prisma.platformSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const value: PlatformSettings = {
      maintenance: { ...DEFAULT_MAINTENANCE, ...(row.maintenance as object) },
      security: { sessionHours: env().SESSION_TTL_HOURS, idleMinutes: 0, ...(row.security as object) },
      branding: { ...DEFAULT_BRANDING, ...(row.branding as object) },
      analytics: { ...DEFAULT_ANALYTICS, ...(row.analytics as object) },
    };
    this.cache = { at: Date.now(), value };
    return value;
  }

  async set<K extends keyof PlatformSettings>(part: K, value: PlatformSettings[K], actor: { userId: string; ip?: string }) {
    const before = (await this.get())[part];
    await this.prisma.platformSettings.update({ where: { id: 1 }, data: { [part]: value as unknown as Prisma.InputJsonObject } });
    this.cache = undefined;
    await this.audit.record({ actorId: actor.userId, action: `platform.settings_${part}_changed`, metadata: { before, after: value } as unknown as Prisma.InputJsonObject, ip: actor.ip });
    return (await this.get())[part];
  }
}

/**
 * During maintenance every request from someone other than a super administrator answers 503 MAINTENANCE, except
 * public routes (sign-in, health, status, legal pages) and the account routes the app needs to show the notice.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (req.auth?.platformRole === 'SUPER_ADMIN') return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    if (/^\/api\/v1\/auth\//.test(req.path)) return true;
    const { maintenance } = await this.settings.get();
    if (!maintenanceState(maintenance, new Date()).active) return true;
    throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'MAINTENANCE', maintenance.message || 'The application is under maintenance', {
      message: maintenance.message,
      endsAt: maintenance.endsAt,
    });
  }
}

@Global()
@Module({ providers: [PlatformSettingsService, MaintenanceGuard], exports: [PlatformSettingsService, MaintenanceGuard] })
export class PlatformSettingsModule {}
