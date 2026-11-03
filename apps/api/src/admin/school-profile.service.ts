import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DEFAULT_SCHOOL_PROFILE,
  SCHOOL_ASSET_KINDS,
  SCHOOL_ASSET_MAX_BYTES,
  SCHOOL_ASSET_TYPES,
  type SchoolAssetKind,
  type SchoolProfile,
} from '@mboka/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/** Everything a document needs to print the school's letterhead. */
export interface Letterhead {
  legalName: string;
  tradingName: string | null;
  profile: SchoolProfile;
  assets: Partial<Record<SchoolAssetKind, Buffer>>;
}

/** PNG and JPEG signatures: the declared type must match the bytes. */
function sniff(data: Buffer): string | null {
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  return null;
}

/**
 * The school's identity on its documents (Phase 8): profile in `tenants.settings.profile`, images in `school_assets`.
 * Reports, receipts, payslips and certificates read it through `letterhead()`.
 */
@Injectable()
export class SchoolProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Pick<Actor, 'tenantId' | 'userId'>, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  static profileOf(settings: Prisma.JsonValue | null): SchoolProfile {
    const stored = ((settings ?? {}) as { profile?: Partial<SchoolProfile> }).profile ?? {};
    return { ...DEFAULT_SCHOOL_PROFILE, ...stored };
  }

  get(a: Actor) {
    return this.run(a, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { legalName: true, tradingName: true, settings: true } });
      const assets = await tx.schoolAsset.findMany({ where: { tenantId: a.tenantId }, select: { kind: true, updatedAt: true } });
      return {
        legalName: tenant.legalName,
        tradingName: tenant.tradingName,
        profile: SchoolProfileService.profileOf(tenant.settings),
        assets: Object.fromEntries(assets.map((x) => [x.kind, x.updatedAt.toISOString()])),
      };
    });
  }

  update(a: Actor, profile: SchoolProfile) {
    return this.run(a, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } });
      const settings = (tenant.settings ?? {}) as Record<string, unknown>;
      await tx.tenant.update({ where: { id: a.tenantId }, data: { settings: { ...settings, profile } as Prisma.InputJsonObject } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'school.profile_updated', entityType: 'tenant', entityId: a.tenantId, ip: a.ip }, tx);
      return profile;
    });
  }

  private kindOrThrow(kind: string): SchoolAssetKind {
    if (!(SCHOOL_ASSET_KINDS as readonly string[]).includes(kind)) throw Errors.notFound('Image');
    return kind as SchoolAssetKind;
  }

  async putAsset(a: Actor, kindParam: string, contentType: string | undefined, data: unknown) {
    const kind = this.kindOrThrow(kindParam);
    if (!Buffer.isBuffer(data) || data.length === 0) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'IMAGE_REQUIRED', 'Send a PNG or JPEG image');
    if (data.length > SCHOOL_ASSET_MAX_BYTES) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, 'IMAGE_TOO_LARGE', 'The image must be 400 KB or less');
    const type = sniff(data);
    if (!type || !(SCHOOL_ASSET_TYPES as readonly string[]).includes(type) || (contentType && !contentType.startsWith(type))) {
      throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'IMAGE_TYPE', 'Only PNG or JPEG images');
    }
    return this.run(a, async (tx) => {
      await tx.schoolAsset.upsert({
        where: { tenantId_kind: { tenantId: a.tenantId, kind } },
        create: { tenantId: a.tenantId, kind, contentType: type, data: new Uint8Array(data), updatedBy: a.userId },
        update: { contentType: type, data: new Uint8Array(data), updatedBy: a.userId },
      });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'school.asset_uploaded', entityType: 'school_asset', entityId: a.tenantId, metadata: { kind, bytes: data.length }, ip: a.ip }, tx);
      return { kind, bytes: data.length };
    });
  }

  async deleteAsset(a: Actor, kindParam: string) {
    const kind = this.kindOrThrow(kindParam);
    await this.run(a, async (tx) => {
      await tx.schoolAsset.deleteMany({ where: { tenantId: a.tenantId, kind } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'school.asset_removed', entityType: 'school_asset', entityId: a.tenantId, metadata: { kind }, ip: a.ip }, tx);
    });
  }

  async asset(a: Actor, kindParam: string) {
    const kind = this.kindOrThrow(kindParam);
    const asset = await this.run(a, (tx) => tx.schoolAsset.findUnique({ where: { tenantId_kind: { tenantId: a.tenantId, kind } } }));
    if (!asset) throw Errors.notFound('Image');
    return { contentType: asset.contentType, data: Buffer.from(asset.data) };
  }

  /** For PDF renderers, inside the caller's school scope. */
  async letterhead(tx: Tx, tenantId: string): Promise<Letterhead> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { legalName: true, tradingName: true, settings: true } });
    const rows = await tx.schoolAsset.findMany({ where: { tenantId } });
    return {
      legalName: tenant.legalName,
      tradingName: tenant.tradingName,
      profile: SchoolProfileService.profileOf(tenant.settings),
      assets: Object.fromEntries(rows.map((r) => [r.kind, Buffer.from(r.data)])),
    };
  }
}
