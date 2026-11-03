import { Injectable } from '@nestjs/common';
import { MODULE_KEYS, type ModuleKey, type ModulePriceInput } from '@mboka/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformActor } from './schools.service';

/**
 * Optional module prices (Phase 7), added to the plan price to quote a school's licence. Invoices still bill the
 * plan price alone; the module total is indicative until invoices itemise modules.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async modules() {
    const prices = new Map((await this.prisma.modulePrice.findMany()).map((p) => [p.module, p]));
    return MODULE_KEYS.map((key) => {
      const p = prices.get(key);
      return { module: key, monthlyPrice: p?.monthlyPrice.toFixed(0) ?? '0', annualPrice: p?.annualPrice.toFixed(0) ?? '0' };
    });
  }

  async setPrice(module: ModuleKey, input: ModulePriceInput, a: PlatformActor) {
    const p = await this.prisma.modulePrice.upsert({ where: { module }, create: { module, ...input }, update: input });
    await this.audit.record({ actorId: a.userId, action: 'platform.module_price_changed', metadata: { module, ...input }, ip: a.ip });
    return { module, monthlyPrice: p.monthlyPrice.toFixed(0), annualPrice: p.annualPrice.toFixed(0) };
  }
}
