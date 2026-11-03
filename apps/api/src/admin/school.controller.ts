import { Controller, Delete, Get, Headers, HttpCode, Param, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { schoolProfileSchema, type SchoolProfile } from '@mboka/shared';
import type { Response } from 'express';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import type { AppRequest } from '../common/request-context';
import { ApiZodBody, ZodBody } from '../common/zod';
import { SchoolProfileService } from './school-profile.service';

/** The school's identity on its documents (Phase 8): profile, logo, coat of arms, stamp and signature. */
@ApiTags('school')
@Controller('school')
export class SchoolController {
  constructor(private readonly profiles: SchoolProfileService) {}

  @Get('profile')
  @RequirePermissions('tenant.settings.read')
  profile(@CurrentActor() a: Actor) {
    return this.profiles.get(a);
  }

  @Put('profile')
  @RequirePermissions('tenant.settings.update')
  @ApiZodBody(schoolProfileSchema)
  update(@CurrentActor() a: Actor, @ZodBody(schoolProfileSchema) body: SchoolProfile) {
    return this.profiles.update(a, body);
  }

  /** Any member of the school may see its images (they are printed on every document). */
  @Get('assets/:kind')
  @RequirePermissions()
  async asset(@CurrentActor() a: Actor, @Param('kind') kind: string, @Res() res: Response) {
    const { contentType, data } = await this.profiles.asset(a, kind);
    res.set({ 'Content-Type': contentType, 'Cache-Control': 'private, max-age=60' }).send(data);
  }

  /** Raw PNG or JPEG body (Content-Type image/png or image/jpeg), 400 KB at most. */
  @Put('assets/:kind')
  @RequirePermissions('tenant.settings.update')
  putAsset(@CurrentActor() a: Actor, @Param('kind') kind: string, @Headers('content-type') contentType: string | undefined, @Req() req: AppRequest) {
    return this.profiles.putAsset(a, kind, contentType, req.body);
  }

  @Delete('assets/:kind')
  @HttpCode(204)
  @RequirePermissions('tenant.settings.update')
  async deleteAsset(@CurrentActor() a: Actor, @Param('kind') kind: string): Promise<void> {
    await this.profiles.deleteAsset(a, kind);
  }
}
