import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { announcementSchema, isoDate, portalAccessSchema, type AnnouncementInput, type PortalAccessInput } from '@mboka/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { Errors } from '../common/api-error';
import { ApiZodBody, ZodBody, ZodPipe } from '../common/zod';
import { AnnouncementsService } from './announcements.service';
import { InsightsService } from './insights.service';
import { NotificationsService } from './notifications.service';
import { PortalService } from './portal.service';

const rangeQuery = z.object({ from: isoDate, to: isoDate });
const langQuery = z.object({ lang: z.enum(['fr', 'en']).default('fr') });

@ApiTags('community')
@Controller()
export class CommunityController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly announcements: AnnouncementsService,
    private readonly portal: PortalService,
    private readonly insights: InsightsService,
  ) {}

  // ------------------------------------------------------------ notifications

  @Get('notifications')
  @RequirePermissions()
  mine(@CurrentActor() a: Actor, @Query('unread') unread?: string) {
    return this.notifications.mine(a, unread === 'true');
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  @RequirePermissions()
  readAll(@CurrentActor() a: Actor) {
    return this.notifications.markRead(a, 'all');
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  @RequirePermissions()
  read(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(a, id);
  }

  @Get('notification-deliveries')
  @RequirePermissions('users.permissions.manage')
  deliveries(@CurrentActor() a: Actor, @Query('status') status?: string) {
    return this.notifications.deliveries(a, status);
  }

  @Post('notification-deliveries/process')
  @HttpCode(200)
  @RequirePermissions('users.permissions.manage')
  process(@CurrentActor() a: Actor) {
    return this.notifications.process(a);
  }

  @Post('notification-deliveries/:id/retry')
  @HttpCode(200)
  @RequirePermissions('users.permissions.manage')
  retry(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.retry(a, id);
  }

  // ------------------------------------------------------------ announcements

  @Get('announcements')
  @RequirePermissions()
  feed(@CurrentActor() a: Actor) {
    return this.announcements.feed(a);
  }

  @Post('announcements')
  @RequirePermissions('announcements.publish')
  @ApiZodBody(announcementSchema)
  publish(@CurrentActor() a: Actor, @ZodBody(announcementSchema) body: AnnouncementInput) {
    return this.announcements.publish(a, body);
  }

  @Delete('announcements/:id')
  @HttpCode(204)
  @RequirePermissions('announcements.publish')
  async remove(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.announcements.remove(a, id);
  }

  // ------------------------------------------------------------ portal access (staff side)

  @Post('guardians/:id/portal-access')
  @RequirePermissions('students.update')
  @ApiZodBody(portalAccessSchema)
  grantGuardian(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(portalAccessSchema) body: PortalAccessInput) {
    return this.portal.grant(a, 'guardian', id, body);
  }

  @Delete('guardians/:id/portal-access')
  @RequirePermissions('students.update')
  revokeGuardian(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.revoke(a, 'guardian', id);
  }

  @Post('students/:id/portal-access')
  @RequirePermissions('students.update')
  @ApiZodBody(portalAccessSchema)
  grantStudent(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(portalAccessSchema) body: PortalAccessInput) {
    return this.portal.grant(a, 'student', id, body);
  }

  @Delete('students/:id/portal-access')
  @RequirePermissions('students.update')
  revokeStudent(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.revoke(a, 'student', id);
  }

  // ------------------------------------------------------------ portal (family side)

  @Get('portal/children')
  @RequirePermissions()
  children(@CurrentActor() a: Actor) {
    if (!a.permissions.has('portal.parent') && !a.permissions.has('portal.student')) throw Errors.forbidden();
    return this.portal.children(a);
  }

  @Get('portal/children/:studentId')
  @RequirePermissions()
  child(@CurrentActor() a: Actor, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.portal.summary(a, studentId);
  }

  @Get('portal/children/:studentId/report-cards/:cardId/pdf')
  @RequirePermissions()
  async childCard(
    @CurrentActor() a: Actor,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Query(new ZodPipe(langQuery)) q: z.infer<typeof langQuery>,
    @Res() res: Response,
  ) {
    const pdf = await this.portal.reportCardPdf(a, studentId, cardId, q.lang);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="bulletin.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }

  // ------------------------------------------------------------ dashboards, comparisons, exports

  @Get('dashboard')
  @RequirePermissions()
  dashboard(@CurrentActor() a: Actor) {
    return this.insights.dashboard(a);
  }

  @Get('reports/annual-comparison')
  @RequirePermissions('reports.financial.read')
  annual(@CurrentActor() a: Actor) {
    return this.insights.annualComparison(a);
  }

  @Get('exports/students.csv')
  @RequirePermissions('students.read')
  async exportStudents(@CurrentActor() a: Actor, @Res() res: Response) {
    send(res, 'eleves.csv', await this.insights.export(a, 'students'));
  }

  @Get('exports/payments.csv')
  @RequirePermissions('reports.financial.read')
  async exportPayments(@CurrentActor() a: Actor, @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>, @Res() res: Response) {
    send(res, `paiements_${q.from}_${q.to}.csv`, await this.insights.export(a, 'payments', q));
  }

  @Get('exports/staff.csv')
  @RequirePermissions('hr.staff.read')
  async exportStaff(@CurrentActor() a: Actor, @Res() res: Response) {
    send(res, 'personnel.csv', await this.insights.export(a, 'staff'));
  }

  @Get('exports/compensation.csv')
  @RequirePermissions('hr.compensation.read')
  async exportCompensation(@CurrentActor() a: Actor, @Res() res: Response) {
    send(res, 'remunerations.csv', await this.insights.export(a, 'compensation'));
  }
}

function send(res: Response, filename: string, csv: string) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }).send(csv);
}
