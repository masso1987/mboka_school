import { HttpStatus, Injectable } from '@nestjs/common';
import { addCycle, subscriptionAccess, type CheckoutInput, type PlanUpdateInput } from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toIso } from '../common/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const presentPlan = (p: Prisma.PlanGetPayload<object>) => ({
  code: p.code,
  nameFr: p.nameFr,
  nameEn: p.nameEn,
  descriptionFr: p.descriptionFr,
  descriptionEn: p.descriptionEn,
  monthlyPrice: p.monthlyPrice.toFixed(0),
  annualPrice: p.annualPrice.toFixed(0),
  maxStudents: p.maxStudents,
  maxCampuses: p.maxCampuses,
  maxUsers: p.maxUsers,
  isPublic: p.isPublic,
  sortOrder: p.sortOrder,
});

const presentInvoice = (i: Prisma.SubscriptionInvoiceGetPayload<object>) => ({
  id: i.id,
  number: i.number,
  plan: i.plan,
  billingCycle: i.billingCycle,
  periodStart: toIso(i.periodStart),
  periodEnd: toIso(i.periodEnd),
  amount: i.amount.toFixed(0),
  currency: i.currency,
  status: i.status,
  createdAt: i.createdAt.toISOString(),
  paidAt: i.paidAt?.toISOString() ?? null,
  paidReference: i.paidReference,
});

/**
 * Plans, a school's subscription and its invoices (Phase 6). Schools choose a plan and cycle, which
 * issues one open invoice; the platform confirms the payment it received, which extends the subscription.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ plans

  publicPlans() {
    return this.prisma.plan.findMany({ where: { isPublic: true }, orderBy: { sortOrder: 'asc' } }).then((ps) => ps.map(presentPlan));
  }

  allPlans() {
    return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } }).then((ps) => ps.map(presentPlan));
  }

  async updatePlan(code: string, input: PlanUpdateInput, actorId: string, ip?: string) {
    const plan = await this.prisma.plan.upsert({ where: { code }, create: { code, ...input }, update: input });
    await this.audit.record({ actorId, action: 'platform.plan_changed', metadata: { code, monthlyPrice: input.monthlyPrice, annualPrice: input.annualPrice }, ip });
    return presentPlan(plan);
  }

  // ------------------------------------------------------------ school side

  private async summary(tx: Tx, tenantId: string) {
    const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
    const access = subscriptionAccess(sub, new Date());
    const [students, campuses, users] = await Promise.all([
      tx.student.count({ where: { tenantId, status: 'ACTIVE' } }),
      tx.campus.count({ where: { tenantId, isActive: true } }),
      tx.membership.count({ where: { tenantId, status: 'ACTIVE' } }),
    ]);
    return {
      plan: sub.plan,
      status: sub.status,
      billingCycle: sub.billingCycle,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      currentUntil: sub.currentUntil?.toISOString() ?? null,
      state: access.state,
      writable: access.writable,
      endsAt: access.endsAt?.toISOString() ?? null,
      daysLeft: access.daysLeft,
      limits: { students: sub.maxStudents, campuses: sub.maxCampuses, users: sub.maxUsers },
      usage: { students, campuses, users },
    };
  }

  overview(a: Actor) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, async (tx) => {
      const [subscription, invoices, plans] = await Promise.all([
        this.summary(tx, a.tenantId),
        tx.subscriptionInvoice.findMany({ where: { tenantId: a.tenantId }, orderBy: { createdAt: 'desc' }, take: 24 }),
        this.publicPlans(),
      ]);
      return {
        subscription,
        plans,
        invoices: invoices.map(presentInvoice),
        paymentInstructions: process.env.PLATFORM_PAYMENT_INSTRUCTIONS ?? null,
      };
    });
  }

  /** Chooses a plan and cycle: replaces any unpaid invoice with one for the next period. */
  checkout(a: Actor, input: CheckoutInput) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, async (tx) => {
      const plan = await tx.plan.findUnique({ where: { code: input.plan } });
      if (!plan || !plan.isPublic) throw Errors.notFound('Plan');
      const s = await this.summary(tx, a.tenantId);
      const over = (['students', 'campuses', 'users'] as const).filter((k) => s.usage[k] > { students: plan.maxStudents, campuses: plan.maxCampuses, users: plan.maxUsers }[k]);
      if (over.length > 0) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'PLAN_TOO_SMALL', 'Your school uses more than this plan allows', { over });
      }
      await tx.subscriptionInvoice.updateMany({ where: { tenantId: a.tenantId, status: 'OPEN' }, data: { status: 'VOID' } });
      const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      // The new period starts when the current one (or the trial) ends, or today if that is past.
      const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const current = sub.status === 'TRIALING' ? sub.trialEndsAt : sub.currentUntil;
      const start = current && current > today ? new Date(`${current.toISOString().slice(0, 10)}T00:00:00Z`) : today;
      const [seq] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('subscription_invoice_number_seq') AS n`;
      const n = seq!.n;
      const invoice = await tx.subscriptionInvoice.create({
        data: {
          tenantId: a.tenantId,
          number: `SUB-${start.getUTCFullYear()}-${String(n).padStart(6, '0')}`,
          plan: plan.code,
          billingCycle: input.cycle,
          periodStart: start,
          periodEnd: addCycle(start, input.cycle),
          amount: input.cycle === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice,
          createdBy: a.userId,
        },
      });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'subscription.invoice_issued', entityType: 'subscription_invoice', entityId: invoice.id, metadata: { plan: plan.code, cycle: input.cycle }, ip: a.ip },
        tx,
      );
      return presentInvoice(invoice);
    });
  }

  // ------------------------------------------------------------ platform side

  /** Every school with its subscription and unpaid invoice, read school by school inside its RLS scope. */
  async platformOverview() {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, slug: true, legalName: true, status: true, createdAt: true } });
    const rows = [];
    for (const t of tenants) {
      rows.push(
        await this.prisma.scoped({ tenantId: t.id }, async (tx) => {
          const open = await tx.subscriptionInvoice.findFirst({ where: { tenantId: t.id, status: 'OPEN' } });
          return { tenant: { ...t, createdAt: t.createdAt.toISOString() }, subscription: await this.summary(tx, t.id), openInvoice: open ? presentInvoice(open) : null };
        }),
      );
    }
    return rows;
  }

  /** Records the payment the platform received; the subscription moves to the invoice's plan and period. */
  confirmPayment(tenantId: string, invoiceId: string, reference: string, actorId: string, ip?: string) {
    return this.prisma.scoped({ tenantId, userId: actorId }, async (tx) => {
      const invoice = await tx.subscriptionInvoice.findFirst({ where: { id: invoiceId, tenantId } });
      if (!invoice) throw Errors.notFound('Invoice');
      if (invoice.status !== 'OPEN') throw Errors.conflict('INVOICE_NOT_OPEN', 'This invoice is not awaiting payment');
      const plan = await tx.plan.findUniqueOrThrow({ where: { code: invoice.plan } });
      await tx.subscriptionInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: new Date(), paidReference: reference, confirmedBy: actorId } });
      await tx.subscription.update({
        where: { tenantId },
        data: {
          plan: plan.code,
          status: 'ACTIVE',
          billingCycle: invoice.billingCycle,
          currentUntil: invoice.periodEnd,
          maxStudents: plan.maxStudents,
          maxCampuses: plan.maxCampuses,
          maxUsers: plan.maxUsers,
        },
      });
      await this.audit.record(
        { tenantId, actorId, action: 'subscription.invoice_paid', entityType: 'subscription_invoice', entityId: invoice.id, metadata: { plan: plan.code, until: toIso(invoice.periodEnd) }, ip },
        tx,
      );
      return this.summary(tx, tenantId);
    });
  }

  voidInvoice(tenantId: string, invoiceId: string, actorId: string, ip?: string) {
    return this.prisma.scoped({ tenantId, userId: actorId }, async (tx) => {
      const { count } = await tx.subscriptionInvoice.updateMany({ where: { id: invoiceId, tenantId, status: 'OPEN' }, data: { status: 'VOID' } });
      if (count === 0) throw Errors.conflict('INVOICE_NOT_OPEN', 'This invoice is not awaiting payment');
      await this.audit.record({ tenantId, actorId, action: 'subscription.invoice_voided', entityType: 'subscription_invoice', entityId: invoiceId, ip }, tx);
    });
  }
}
