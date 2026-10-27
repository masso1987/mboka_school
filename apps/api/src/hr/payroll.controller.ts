import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  payrollReturnSchema,
  payrollRulesSchema,
  payrollRunCreateSchema,
  payslipInputSchema,
  type PayrollRules,
  type PayrollRunCreateInput,
  type PayslipInput,
} from '@mboka/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { ApiZodBody, ZodBody, ZodPipe } from '../common/zod';
import { PayrollService } from './payroll.service';
import { renderPayslipsPdf } from './payslip.pdf';

const langQuery = z.object({ lang: z.enum(['fr', 'en']).default('fr') });

/** Monthly payroll (Phase 6). Preparing needs hr.payroll.manage; approval needs hr.payroll.approve and another person. */
@ApiTags('payroll')
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('rules')
  @RequirePermissions('hr.payroll.manage')
  rules(@CurrentActor() a: Actor) {
    return this.payroll.rules(a);
  }

  @Put('rules')
  @RequirePermissions('hr.payroll.manage')
  @ApiZodBody(payrollRulesSchema)
  updateRules(@CurrentActor() a: Actor, @ZodBody(payrollRulesSchema) body: PayrollRules) {
    return this.payroll.updateRules(a, body);
  }

  @Get('runs')
  @RequirePermissions('hr.payroll.manage')
  runs(@CurrentActor() a: Actor) {
    return this.payroll.listRuns(a);
  }

  @Post('runs')
  @RequirePermissions('hr.payroll.manage')
  @ApiZodBody(payrollRunCreateSchema)
  createRun(@CurrentActor() a: Actor, @ZodBody(payrollRunCreateSchema) body: PayrollRunCreateInput) {
    return this.payroll.createRun(a, body.period);
  }

  @Get('runs/:id')
  @RequirePermissions('hr.payroll.manage')
  run(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.getRun(a, id);
  }

  @Delete('runs/:id')
  @HttpCode(204)
  @RequirePermissions('hr.payroll.manage')
  async deleteRun(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.payroll.deleteRun(a, id);
  }

  @Post('runs/:id/refresh')
  @HttpCode(200)
  @RequirePermissions('hr.payroll.manage')
  refresh(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.refreshRun(a, id);
  }

  @Post('runs/:id/submit')
  @HttpCode(200)
  @RequirePermissions('hr.payroll.manage')
  submit(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.submit(a, id);
  }

  @Post('runs/:id/approve')
  @HttpCode(200)
  @RequirePermissions('hr.payroll.approve')
  approve(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.approve(a, id);
  }

  @Post('runs/:id/return')
  @HttpCode(200)
  @RequirePermissions('hr.payroll.approve')
  @ApiZodBody(payrollReturnSchema)
  sendBack(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(payrollReturnSchema) body: z.infer<typeof payrollReturnSchema>) {
    return this.payroll.sendBack(a, id, body.reason);
  }

  @Post('runs/:id/paid')
  @HttpCode(200)
  @RequirePermissions('hr.payroll.manage')
  paid(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.markPaid(a, id);
  }

  @Get('runs/:id/payslips.pdf')
  @RequirePermissions('hr.payroll.manage')
  async runPdf(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(langQuery)) q: z.infer<typeof langQuery>, @Res() res: Response) {
    const pdf = await renderPayslipsPdf(await this.payroll.payslipsForPdf(a, { runId: id }), q.lang);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="bulletins-de-paie.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }

  @Get('runs/:id/declarations.csv')
  @RequirePermissions('hr.payroll.manage')
  async declarations(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { period, csv } = await this.payroll.declarationsCsv(a, id);
    res
      .set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="declarations-${period}.csv"`, 'Cache-Control': 'no-store' })
      .send(csv);
  }

  @Get('payslips/:id')
  @RequirePermissions('hr.payroll.manage')
  payslip(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.getPayslip(a, id);
  }

  @Put('payslips/:id')
  @RequirePermissions('hr.payroll.manage')
  @ApiZodBody(payslipInputSchema)
  updatePayslip(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(payslipInputSchema) body: PayslipInput) {
    return this.payroll.updatePayslip(a, id, body);
  }

  @Get('payslips/:id/pdf')
  @RequirePermissions('hr.payroll.manage')
  async payslipPdf(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(langQuery)) q: z.infer<typeof langQuery>, @Res() res: Response) {
    const pdf = await renderPayslipsPdf(await this.payroll.payslipsForPdf(a, { payslipId: id }), q.lang);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="bulletin-de-paie.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }

  // ------------------------------------------------------------ employee self-service

  /** The signed-in employee's own approved payslips; no payroll permission needed. */
  @Get('me/payslips')
  @RequirePermissions()
  mine(@CurrentActor() a: Actor) {
    return this.payroll.myPayslips(a);
  }

  @Get('me/payslips/:id/pdf')
  @RequirePermissions()
  async minePdf(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(langQuery)) q: z.infer<typeof langQuery>, @Res() res: Response) {
    const pdf = await renderPayslipsPdf(await this.payroll.payslipsForPdf(a, { payslipId: id, own: true }), q.lang);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="bulletin-de-paie.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }
}
