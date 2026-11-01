import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  compensationSchema,
  contractSchema,
  entitlementSchema,
  leaveDecisionSchema,
  leaveRequestSchema,
  type CompensationInput,
  type ContractInput,
  type EntitlementInput,
  type LeaveDecisionInput,
  type LeaveRequestInput,
} from '@mboka/shared';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { ApiZodBody, ZodBody } from '../common/zod';
import { HrService } from './hr.service';

@ApiTags('hr')
@Controller('hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get('contracts')
  @RequirePermissions('hr.staff.read')
  contracts(@CurrentActor() a: Actor, @Query('staffId', new ParseUUIDPipe({ optional: true })) staffId?: string) {
    return this.hr.listContracts(a, staffId);
  }

  @Post('contracts')
  @RequirePermissions('hr.staff.manage')
  @ApiZodBody(contractSchema)
  createContract(@CurrentActor() a: Actor, @ZodBody(contractSchema) body: ContractInput) {
    return this.hr.createContract(a, body);
  }

  @Get('contracts/expiring')
  @RequirePermissions('hr.staff.read')
  expiring(@CurrentActor() a: Actor, @Query('days') days = '60') {
    return this.hr.expiringContracts(a, Math.min(Math.max(Number(days) || 60, 1), 365));
  }

  @Get('compensation/:staffId')
  @RequirePermissions('hr.compensation.read')
  compensation(@CurrentActor() a: Actor, @Param('staffId', ParseUUIDPipe) staffId: string) {
    return this.hr.listCompensation(a, staffId);
  }

  @Post('compensation')
  @RequirePermissions('hr.compensation.manage')
  @ApiZodBody(compensationSchema)
  recordCompensation(@CurrentActor() a: Actor, @ZodBody(compensationSchema) body: CompensationInput) {
    return this.hr.recordCompensation(a, body);
  }

  @Get('leave')
  @RequirePermissions()
  leave(@CurrentActor() a: Actor, @Query('status') status?: string) {
    return this.hr.listLeave(a, status);
  }

  @Post('leave')
  @RequirePermissions('hr.leave.request')
  @ApiZodBody(leaveRequestSchema)
  requestLeave(@CurrentActor() a: Actor, @ZodBody(leaveRequestSchema) body: LeaveRequestInput) {
    return this.hr.request(a, body);
  }

  @Post('leave/:id/decision')
  @HttpCode(200)
  @RequirePermissions('hr.leave.approve')
  @ApiZodBody(leaveDecisionSchema)
  decide(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(leaveDecisionSchema) body: LeaveDecisionInput) {
    return this.hr.decide(a, id, body);
  }

  @Post('leave/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('hr.leave.request')
  cancel(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.hr.cancel(a, id);
  }

  @Get('leave/balances')
  @RequirePermissions('hr.staff.read')
  balances(@CurrentActor() a: Actor, @Query('year') year?: string) {
    return this.hr.balances(a, Number(year) || new Date().getUTCFullYear());
  }

  @Put('leave/entitlements')
  @RequirePermissions('hr.staff.manage')
  @ApiZodBody(entitlementSchema)
  entitlement(@CurrentActor() a: Actor, @ZodBody(entitlementSchema) body: EntitlementInput) {
    return this.hr.setEntitlement(a, body);
  }
}
