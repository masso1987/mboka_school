import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  activeSchema,
  auditQuerySchema,
  loginHistoryQuerySchema,
  platformUsersQuerySchema,
  personInviteSchema,
  schoolUpdateSchema,
  type ActiveInput,
  type PersonInviteInput,
  type SchoolUpdateInput,
} from '@mboka/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { PlatformAdmin } from '../auth/decorators';
import { type AppRequest, type AuthContext, clientIp, CurrentAuth } from '../common/request-context';
import { ApiZodBody, ZodBody } from '../common/zod';
import { ActivityService } from './activity.service';
import { DashboardService } from './dashboard.service';
import { PlatformAdminsService } from './platform-admins.service';
import { type PlatformActor, SchoolsService } from './schools.service';

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
  ) {}

  @Get('dashboard')
  home() {
    return this.dashboard.dashboard();
  }

  // ------------------------------------------------------------ schools

  @Get('schools')
  listSchools(@Query() query: Record<string, string>) {
    const q = listQuery.parse(query);
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
  users(@Query() query: Record<string, string>) {
    return this.activity.users(platformUsersQuerySchema.parse(query));
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
  async logins(@Query() query: Record<string, string>, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const q = loginHistoryQuerySchema.parse(query);
    const result = await this.activity.logins(q, actor(auth, req));
    return typeof result === 'string' ? csv(res, 'connexions.csv', result) : result;
  }

  @Get('audit')
  async auditLog(@Query() query: Record<string, string>, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const q = auditQuerySchema.parse(query);
    const result = await this.activity.auditLog(q, actor(auth, req));
    return typeof result === 'string' ? csv(res, 'journal-audit.csv', result) : result;
  }
}

function csv(res: Response, filename: string, body: string) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
  return body;
}
