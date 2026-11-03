import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  activeSchema,
  auditQuerySchema,
  analyticsSchema,
  brandingSchema,
  demoCreateSchema,
  demoExtendSchema,
  legalDocumentSchema,
  maintenanceSchema,
  platformMessageSchema,
  schoolBackupSchema,
  sqlQuerySchema,
  securitySchema,
  licenceSchema,
  MODULE_KEYS,
  modulePriceSchema,
  loginHistoryQuerySchema,
  platformUsersQuerySchema,
  personInviteSchema,
  schoolUpdateSchema,
  type ActiveInput,
  type AuditQuery,
  type AnalyticsSettings,
  type BrandingSettings,
  type DemoCreateInput,
  type LegalDocumentInput,
  type MaintenanceSettings,
  type PlatformMessageInput,
  type SecuritySettings,
  type SqlQueryInput,
  type LoginHistoryQuery,
  type PlatformUsersQuery,
  type LicenceInput,
  type ModuleKey,
  type ModulePriceInput,
  type PersonInviteInput,
  type SchoolUpdateInput,
} from '@mboka/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { PlatformAdmin } from '../auth/decorators';
import { Errors } from '../common/api-error';
import { type AppRequest, type AuthContext, clientIp, CurrentAuth } from '../common/request-context';
import { ApiZodBody, ZodBody, ZodPipe } from '../common/zod';
import { ActivityService } from './activity.service';
import { BackupsService } from './backups.service';
import { CommunicationService } from './communication.service';
import { DashboardService } from './dashboard.service';
import { DemoService } from './demo.service';
import { PlatformAdminsService } from './platform-admins.service';
import { PricingService } from './pricing.service';
import { type PlatformActor, SchoolsService } from './schools.service';
import { PlatformSettingsService } from './settings.service';
import { SystemService } from './system.service';

const listQuery = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']).optional() });
const actor = (auth: AuthContext, req: AppRequest): PlatformActor => ({ userId: auth.userId, ip: clientIp(req) });

/** Platform console (Phase 7): home, schools and their admins, the platform team. Super administrators only. */
@ApiTags('platform')
@PlatformAdmin()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly schools: SchoolsService,
    private readonly admins: PlatformAdminsService,
    private readonly activity: ActivityService,
    private readonly pricing: PricingService,
    private readonly settings: PlatformSettingsService,
    private readonly communication: CommunicationService,
    private readonly demos: DemoService,
    private readonly system: SystemService,
    private readonly backups: BackupsService,
  ) {}

  @Get('dashboard')
  home() {
    return this.dashboard.dashboard();
  }

  // ------------------------------------------------------------ schools

  @Get('schools')
  listSchools(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.schools.list(q.q || undefined, q.status);
  }

  @Get('schools/:id')
  school(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.detail(id);
  }

  @Patch('schools/:id')
  @ApiZodBody(schoolUpdateSchema)
  updateSchool(@Param('id', ParseUUIDPipe) id: string, @ZodBody(schoolUpdateSchema) body: SchoolUpdateInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.schools.update(id, body, actor(auth, req));
  }

  @Post('schools/:id/admins')
  @ApiZodBody(personInviteSchema)
  addSchoolAdmin(@Param('id', ParseUUIDPipe) id: string, @ZodBody(personInviteSchema) body: PersonInviteInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.schools.addAdmin(id, body, actor(auth, req));
  }

  @Post('schools/:id/admins/:userId/reset')
  @HttpCode(200)
  resetSchoolAdmin(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.schools.resetAdmin(id, userId, actor(auth, req));
  }

  @Patch('schools/:id/admins/:userId/status')
  @ApiZodBody(activeSchema)
  setSchoolAdminStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @ZodBody(activeSchema) body: ActiveInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.schools.setAdminActive(id, userId, body, actor(auth, req));
  }

  @Get('schools/:id/licence')
  licence(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.licence(id);
  }

  @Put('schools/:id/licence')
  @ApiZodBody(licenceSchema)
  setLicence(@Param('id', ParseUUIDPipe) id: string, @ZodBody(licenceSchema) body: LicenceInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.schools.setLicence(id, body, actor(auth, req));
  }

  // ------------------------------------------------------------ settings: maintenance, sessions, branding

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings/maintenance')
  @ApiZodBody(maintenanceSchema)
  setMaintenance(@ZodBody(maintenanceSchema) body: MaintenanceSettings, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.settings.set('maintenance', body, actor(auth, req));
  }

  @Put('settings/security')
  @ApiZodBody(securitySchema)
  setSecurity(@ZodBody(securitySchema) body: SecuritySettings, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.settings.set('security', body, actor(auth, req));
  }

  @Put('settings/branding')
  @ApiZodBody(brandingSchema)
  setBranding(@ZodBody(brandingSchema) body: BrandingSettings, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.settings.set('branding', body, actor(auth, req));
  }

  @Put('settings/analytics')
  @ApiZodBody(analyticsSchema)
  setAnalytics(@ZodBody(analyticsSchema) body: AnalyticsSettings, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.settings.set('analytics', body, actor(auth, req));
  }

  // ------------------------------------------------------------ system and database console

  @Get('system/overview')
  systemOverview() {
    return this.system.overview();
  }

  @Get('system/health')
  systemHealth() {
    return this.system.health();
  }

  @Get('system/database')
  systemDatabase() {
    return this.system.database();
  }

  @Get('system/sql')
  sqlMode() {
    return { writeEnabled: this.system.writeEnabled() };
  }

  @Post('system/sql')
  @HttpCode(200)
  @ApiZodBody(sqlQuerySchema)
  runSql(@ZodBody(sqlQuerySchema) body: SqlQueryInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.system.sql(body.sql, body.confirmation, actor(auth, req));
  }

  @Get('system/processes')
  systemProcesses() {
    return this.system.processes();
  }

  @Get('system/disks')
  systemDisks() {
    return this.system.disks();
  }

  @Get('system/services')
  systemServices() {
    return this.system.services();
  }

  @Post('system/services/:id/:action')
  @HttpCode(200)
  containerAction(@Param('id') id: string, @Param('action') action: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    if (!/^[0-9a-f]{12}$/.test(id) || !['start', 'stop', 'restart'].includes(action)) throw Errors.notFound('Container');
    return this.system.containerAction(id, action as 'start' | 'stop' | 'restart', actor(auth, req));
  }

  @Get('system/services/:id/logs')
  containerLogs(@Param('id') id: string) {
    if (!/^[0-9a-f]{12}$/.test(id)) throw Errors.notFound('Container');
    return this.system.containerLogs(id);
  }

  @Get('system/firewall')
  firewall() {
    return this.system.firewall();
  }

  // ------------------------------------------------------------ backups

  /** Downloads one school's complete data, gzipped and encrypted with the password sent (never stored). */
  @Post('schools/:id/backup')
  @HttpCode(200)
  @ApiZodBody(schoolBackupSchema)
  async schoolBackup(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(schoolBackupSchema) body: { password: string },
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res() res: Response,
  ) {
    const { filename, file } = await this.backups.schoolBackup(id, body.password, actor(auth, req));
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }).send(file);
  }

  @Get('backups')
  listBackups() {
    return this.backups.list();
  }

  @Post('backups')
  runBackup(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.backups.runBackup(actor(auth, req));
  }

  @Get('backups/requests/:id')
  backupRequest(@Param('id') id: string) {
    return this.backups.request(id);
  }

  @Post('backups/:name/restore-test')
  restoreTest(@Param('name') name: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.backups.runRestoreTest(name, actor(auth, req));
  }

  @Get('backups/:name/download')
  async downloadBackup(@Param('name') name: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest, @Res() res: Response) {
    const { stream, size } = await this.backups.download(name, actor(auth, req));
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(size), 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    stream.pipe(res);
  }

  // ------------------------------------------------------------ legal documents and messages

  @Get('legal')
  legal() {
    return this.communication.legalHistory();
  }

  @Post('legal')
  @ApiZodBody(legalDocumentSchema)
  publishLegal(@ZodBody(legalDocumentSchema) body: LegalDocumentInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.communication.publishLegal(body, actor(auth, req));
  }

  @Get('messages')
  messages() {
    return this.communication.messages();
  }

  @Post('messages')
  @ApiZodBody(platformMessageSchema)
  sendMessage(@ZodBody(platformMessageSchema) body: PlatformMessageInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.communication.sendMessage(body, actor(auth, req));
  }

  // ------------------------------------------------------------ demo schools

  @Get('demos')
  listDemos() {
    return this.demos.list();
  }

  @Post('demos')
  @ApiZodBody(demoCreateSchema)
  createDemo(@ZodBody(demoCreateSchema) body: DemoCreateInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.demos.create(body, actor(auth, req));
  }

  @Post('demos/:id/extend')
  @HttpCode(200)
  @ApiZodBody(demoExtendSchema)
  extendDemo(@Param('id', ParseUUIDPipe) id: string, @ZodBody(demoExtendSchema) body: { days: number }, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.demos.extend(id, body.days, actor(auth, req));
  }

  @Post('demos/:id/recreate')
  recreateDemo(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.demos.recreate(id, actor(auth, req));
  }

  @Post('demos/:id/close')
  @HttpCode(200)
  closeDemo(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.demos.close(id, actor(auth, req));
  }

  // ------------------------------------------------------------ module prices

  @Get('modules')
  modules() {
    return this.pricing.modules();
  }

  @Put('modules/:module/price')
  @ApiZodBody(modulePriceSchema)
  setModulePrice(@Param('module') module: string, @ZodBody(modulePriceSchema) body: ModulePriceInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    if (!(MODULE_KEYS as string[]).includes(module)) throw Errors.notFound('Module');
    return this.pricing.setPrice(module as ModuleKey, body, actor(auth, req));
  }

  // ------------------------------------------------------------ platform administrators

  @Get('admins')
  listAdmins() {
    return this.admins.list();
  }

  @Post('admins')
  @ApiZodBody(personInviteSchema)
  addAdmin(@ZodBody(personInviteSchema) body: PersonInviteInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.admins.create(body, actor(auth, req));
  }

  @Post('admins/:userId/reset')
  @HttpCode(200)
  resetAdmin(@Param('userId', ParseUUIDPipe) userId: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.admins.reset(userId, actor(auth, req));
  }

  @Patch('admins/:userId/status')
  @ApiZodBody(activeSchema)
  setAdminStatus(@Param('userId', ParseUUIDPipe) userId: string, @ZodBody(activeSchema) body: ActiveInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.admins.setActive(userId, body, actor(auth, req));
  }

  // ------------------------------------------------------------ users and sessions

  @Get('users')
  users(@Query(new ZodPipe(platformUsersQuerySchema)) q: PlatformUsersQuery) {
    return this.activity.users(q);
  }

  @Get('users/:userId/sessions')
  userSessions(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.activity.userSessions(userId);
  }

  @Patch('users/:userId/status')
  @ApiZodBody(activeSchema)
  setUserStatus(@Param('userId', ParseUUIDPipe) userId: string, @ZodBody(activeSchema) body: ActiveInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.activity.setActive(userId, body, actor(auth, req));
  }

  @Post('users/:userId/disconnect')
  @HttpCode(200)
  disconnect(@Param('userId', ParseUUIDPipe) userId: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.activity.disconnect(userId, actor(auth, req));
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async revokeSession(@Param('sessionId', ParseUUIDPipe) sessionId: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest): Promise<void> {
    await this.activity.revokeSession(sessionId, actor(auth, req));
  }

  // ------------------------------------------------------------ sign-in history and audit log

  @Get('logins')
  async logins(@Query(new ZodPipe(loginHistoryQuerySchema)) q: LoginHistoryQuery, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const result = await this.activity.logins(q, actor(auth, req));
    return typeof result === 'string' ? csv(res, 'connexions.csv', result) : result;
  }

  @Get('audit')
  async auditLog(@Query(new ZodPipe(auditQuerySchema)) q: AuditQuery, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const result = await this.activity.auditLog(q, actor(auth, req));
    return typeof result === 'string' ? csv(res, 'journal-audit.csv', result) : result;
  }
}

function csv(res: Response, filename: string, body: string) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
  return body;
}
