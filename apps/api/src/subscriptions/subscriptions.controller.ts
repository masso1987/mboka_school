import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  checkoutSchema,
  invoicePaymentSchema,
  planUpdateSchema,
  resendVerificationSchema,
  signupSchema,
  verifyEmailSchema,
  type CheckoutInput,
  type PlanUpdateInput,
  type SignupInput,
} from '@mboka/shared';
import { z } from 'zod';
import { AllowWhenReadOnly, PlatformAdmin, Public, RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { Errors } from '../common/api-error';
import { type AppRequest, type AuthContext, clientIp, CurrentAuth } from '../common/request-context';
import { ApiZodBody, ZodBody } from '../common/zod';
import { SignupService } from './signup.service';
import { SubscriptionsService } from './subscriptions.service';

/** Public: plan catalogue and self-service sign-up. Strictly rate-limited per client. */
@ApiTags('signup')
@Controller()
export class SignupController {
  constructor(
    private readonly signups: SignupService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Public()
  @Get('public/plans')
  plans() {
    return this.subscriptions.publicPlans();
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('signup')
  @HttpCode(202)
  @ApiZodBody(signupSchema)
  signup(@ZodBody(signupSchema) body: SignupInput, @Req() req: AppRequest) {
    return this.signups.signup(body, clientIp(req));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post('signup/verify')
  @HttpCode(200)
  @ApiZodBody(verifyEmailSchema)
  verify(@ZodBody(verifyEmailSchema) body: z.infer<typeof verifyEmailSchema>, @Req() req: AppRequest) {
    return this.signups.verify(body.token, clientIp(req));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('signup/resend')
  @HttpCode(202)
  @ApiZodBody(resendVerificationSchema)
  resend(@ZodBody(resendVerificationSchema) body: z.infer<typeof resendVerificationSchema>, @Req() req: AppRequest) {
    return this.signups.resend(body.email, clientIp(req));
  }
}

/** A school's own subscription. Reachable even when the subscription has lapsed, so the school can pay. */
@ApiTags('subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @AllowWhenReadOnly()
  @RequirePermissions('tenant.settings.read')
  overview(@CurrentActor() a: Actor) {
    return this.subscriptions.overview(a);
  }

  @Post('checkout')
  @AllowWhenReadOnly()
  @RequirePermissions('tenant.settings.update')
  @ApiZodBody(checkoutSchema)
  checkout(@CurrentActor() a: Actor, @ZodBody(checkoutSchema) body: CheckoutInput) {
    return this.subscriptions.checkout(a, body);
  }
}

/** Platform administration of plans and school subscriptions. Grants no access to school data. */
@ApiTags('platform')
@PlatformAdmin()
@Controller('platform')
export class PlatformSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('plans')
  plans() {
    return this.subscriptions.allPlans();
  }

  @Put('plans/:code')
  @ApiZodBody(planUpdateSchema)
  updatePlan(@Param('code') code: string, @ZodBody(planUpdateSchema) body: PlanUpdateInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    if (!/^[a-z0-9_-]{2,30}$/.test(code)) throw Errors.notFound('Plan');
    return this.subscriptions.updatePlan(code, body, auth.userId, clientIp(req));
  }

  @Get('subscriptions')
  overview() {
    return this.subscriptions.platformOverview();
  }

  @Post('tenants/:tenantId/subscription-invoices/:id/pay')
  @HttpCode(200)
  @ApiZodBody(invoicePaymentSchema)
  pay(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(invoicePaymentSchema) body: z.infer<typeof invoicePaymentSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.subscriptions.confirmPayment(tenantId, id, body.reference, auth.userId, clientIp(req));
  }

  @Post('tenants/:tenantId/subscription-invoices/:id/void')
  @HttpCode(204)
  async void(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    await this.subscriptions.voidInvoice(tenantId, id, auth.userId, clientIp(req));
  }
}
