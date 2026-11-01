import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PaymentInput } from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { Errors } from '../common/api-error';
import { decryptSecret } from '../common/secrets';
import { PrismaService } from '../prisma/prisma.service';
import { collectionStatus, type OperatorConfig, OperatorError, startCollection } from './mobile-money';
import { PaymentsService } from './payments.service';

const OPERATOR_KINDS = ['MTN_MOMO', 'ORANGE_MONEY'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mobile Money through the operators (Phase 6): starts the collection after the payment is recorded
 * as pending, and settles it only from the operator's own status answer — on demand ("Verify"), when
 * the operator notifies us, and from a periodic reconciliation for payments nobody looked at.
 */
@Injectable()
export class MobileMoneyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MobileMoney');
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    const seconds = Number(process.env.MOBILE_MONEY_POLL_SECONDS ?? 60);
    if (seconds > 0) {
      this.timer = setInterval(() => void this.reconcile(), seconds * 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Records the payment, then asks the operator to collect it (outside the database transaction). */
  async record(a: Actor, input: PaymentInput) {
    const payment = await this.payments.record(a, input);
    if (!input.provider) return payment;
    const provider = await this.prisma.scoped({ tenantId: a.tenantId }, (tx) =>
      tx.paymentProvider.findUnique({ where: { tenantId_code: { tenantId: a.tenantId, code: input.provider! } } }),
    );
    if (!provider || !OPERATOR_KINDS.includes(provider.kind)) return payment;
    if (payment.replayed) return { ...payment, paymentUrl: await this.storedPaymentUrl(a.tenantId, payment.id) };
    const started = await this.start(a.tenantId, payment.id);
    return { ...payment, status: started.status, paymentUrl: started.paymentUrl ?? null };
  }

  private async storedPaymentUrl(tenantId: string, paymentId: string) {
    const p = await this.prisma.scoped({ tenantId }, (tx) => tx.payment.findUnique({ where: { id: paymentId }, select: { providerState: true } }));
    return ((p?.providerState ?? {}) as Record<string, string>).paymentUrl ?? null;
  }

  private async load(tenantId: string, paymentId: string) {
    return this.prisma.scoped({ tenantId }, async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id: paymentId, tenantId } });
      if (!payment?.provider) return null;
      const provider = await tx.paymentProvider.findUnique({ where: { tenantId_code: { tenantId, code: payment.provider } } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
      if (!provider || !OPERATOR_KINDS.includes(provider.kind)) return null;
      return { payment, provider, slug: tenant.slug, config: JSON.parse(decryptSecret(provider.secretEncrypted)) as OperatorConfig };
    });
  }

  private async start(tenantId: string, paymentId: string): Promise<{ status: string; paymentUrl?: string }> {
    const ctx = await this.load(tenantId, paymentId);
    if (!ctx) return { status: 'PENDING_VERIFICATION' };
    const { payment, config } = ctx;
    const publicUrl = (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
    try {
      const started = await startCollection(config, {
        reference: payment.id,
        amount: payment.amount.toString(),
        currency: payment.currency,
        msisdn: payment.payerMsisdn ?? undefined,
        description: `Mboka ${payment.id.slice(0, 8)}`,
        callbackUrl: `${publicUrl}/api/v1/payment-callbacks/${ctx.slug}/${payment.provider}/notify`,
      });
      const state = { ...started.state, ...(started.paymentUrl && { paymentUrl: started.paymentUrl }) };
      await this.prisma.scoped({ tenantId }, (tx) => tx.payment.update({ where: { id: payment.id }, data: { providerState: state } }));
      return { status: 'PENDING_VERIFICATION', paymentUrl: started.paymentUrl };
    } catch (e) {
      if (!(e instanceof OperatorError)) throw e;
      // A refusal (4xx) is final. An unreachable MTN may still have received the request: keep it pending
      // with its reference so the status check settles it. Orange without a pay token can never complete.
      const refused = e.httpStatus !== null && e.httpStatus < 500;
      const uncertain = !refused && config.kind === 'MTN_MOMO';
      await this.prisma.scoped({ tenantId }, async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: uncertain
            ? { providerState: { referenceId: payment.id } }
            : { status: 'FAILED', failureReason: `${refused ? 'operator_refused' : 'operator_unreachable'}${e.httpStatus ? `_${e.httpStatus}` : ''}` },
        });
        await this.audit.record(
          { tenantId, action: 'payment.provider_start_failed', entityType: 'payment', entityId: payment.id, metadata: { provider: payment.provider, httpStatus: e.httpStatus, uncertain } },
          tx,
        );
      });
      this.logger.warn(`${config.kind} start failed for payment ${payment.id}: ${e.message}`);
      return { status: uncertain ? 'PENDING_VERIFICATION' : 'FAILED' };
    }
  }

  /** Asks the operator for the result and applies it. Safe to call any number of times. */
  async check(tenantId: string, paymentId: string): Promise<{ status: string; outcome: string }> {
    const ctx = await this.load(tenantId, paymentId);
    if (!ctx) throw Errors.notFound('Payment');
    const state = (ctx.payment.providerState ?? null) as Record<string, string> | null;
    if (ctx.payment.status !== 'PENDING_VERIFICATION' || !state) return { status: ctx.payment.status, outcome: 'not_pending' };

    let result;
    try {
      result = await collectionStatus(ctx.config, state);
    } catch (e) {
      if (!(e instanceof OperatorError)) throw e;
      this.logger.warn(`${ctx.config.kind} status unavailable for payment ${paymentId}: ${e.message}`);
      return { status: ctx.payment.status, outcome: 'operator_unavailable' };
    }

    if (result.status === 'PENDING') {
      await this.prisma.scoped({ tenantId }, (tx) => tx.payment.update({ where: { id: paymentId }, data: { providerCheckedAt: new Date() } }));
      return { status: 'PENDING_VERIFICATION', outcome: 'still_pending' };
    }
    try {
      return await this.prisma.scoped({ tenantId }, async (tx) => {
        const payment = await tx.payment.findUnique({ where: { id: paymentId } });
        await tx.payment.update({ where: { id: paymentId }, data: { providerCheckedAt: new Date() } });
        const outcome = await this.payments.applyProviderResult(
          tx,
          tenantId,
          ctx.payment.provider!,
          payment,
          {
            transactionId: result.transactionId ?? paymentId,
            status: result.status,
            amount: result.amount ?? '0',
            // Orange does not echo the currency; the amount checked is the one registered with its token.
            currency: result.currency ?? ctx.payment.currency,
            reason: result.reason,
          },
          { source: 'status_check', ...result } as Prisma.InputJsonValue,
        );
        const after = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } });
        return { status: after.status, outcome };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && e.meta?.modelName === 'PaymentProviderEvent') {
        return { status: ctx.payment.status, outcome: 'duplicate' };
      }
      throw e;
    }
  }

  verify(a: Actor, paymentId: string) {
    return this.check(a.tenantId, paymentId);
  }

  /**
   * Operator notification. Unsigned, so it is only a prompt to check: the body names the payment
   * (MTN: externalId = our payment id; Orange: the notif_token we stored) and is never applied itself.
   * Answers the same way whatever happens, so it reveals nothing.
   */
  async notify(tenantSlug: string, providerCode: string, body: unknown) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, status: true } });
    if (!tenant || tenant.status !== 'ACTIVE') return { received: true };
    const b = (body ?? {}) as Record<string, unknown>;
    const paymentId = await this.prisma.scoped({ tenantId: tenant.id }, async (tx) => {
      const provider = await tx.paymentProvider.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code: providerCode } } });
      if (!provider || !OPERATOR_KINDS.includes(provider.kind)) return null;
      if (provider.kind === 'MTN_MOMO') {
        const id = typeof b.externalId === 'string' ? b.externalId : typeof b.referenceId === 'string' ? b.referenceId : '';
        return UUID.test(id) ? id : null;
      }
      const token = typeof b.notif_token === 'string' ? b.notif_token : '';
      if (!token) return null;
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM payments WHERE tenant_id = ${tenant.id}::uuid AND provider = ${providerCode} AND provider_state ->> 'notifToken' = ${token} LIMIT 1`;
      return rows[0]?.id ?? null;
    });
    if (paymentId) {
      try {
        await this.check(tenant.id, paymentId);
      } catch (e) {
        this.logger.warn(`notification check failed for payment ${paymentId}: ${(e as Error).message}`);
      }
    }
    return { received: true };
  }

  /** Periodic pass over pending operator payments, school by school, inside each school's RLS scope. */
  async reconcile(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let checked = 0;
    try {
      const tenants = await this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      const stale = new Date(Date.now() - 30_000);
      for (const t of tenants) {
        const pending = await this.prisma.scoped({ tenantId: t.id }, (tx) =>
          tx.payment.findMany({
            where: {
              tenantId: t.id,
              status: 'PENDING_VERIFICATION',
              provider: { not: null },
              providerState: { not: Prisma.DbNull },
              createdAt: { lt: new Date(Date.now() - 20_000) },
              OR: [{ providerCheckedAt: null }, { providerCheckedAt: { lt: stale } }],
            },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
            take: 50,
          }),
        );
        for (const p of pending) {
          await this.check(t.id, p.id).catch((e) => this.logger.warn(`reconcile ${p.id}: ${(e as Error).message}`));
          checked++;
        }
      }
    } finally {
      this.sweeping = false;
    }
    return checked;
  }
}
