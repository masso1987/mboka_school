import { Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { academicYearSchema, type AcademicYearInput } from '@mboka/shared';
import { RequirePermissions } from '../auth/decorators';
import {
  type AppRequest,
  type AuthContext,
  clientIp,
  CurrentAuth,
  CurrentTenant,
  type TenantContext,
} from '../common/request-context';
import { ApiZodBody, ZodBody } from '../common/zod';
import { AcademicYearsService } from './academic-years.service';

@ApiTags('academics')
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly years: AcademicYearsService) {}

  @Get()
  @RequirePermissions('academics.years.read')
  list(@CurrentAuth() auth: AuthContext, @CurrentTenant() t: TenantContext) {
    return this.years.list(t.tenantId, auth.userId);
  }

  @Get(':id')
  @RequirePermissions('academics.years.read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentTenant() t: TenantContext) {
    return this.years.get(t.tenantId, auth.userId, id);
  }

  @Post()
  @RequirePermissions('academics.years.manage')
  @ApiZodBody(academicYearSchema)
  create(
    @ZodBody(academicYearSchema) body: AcademicYearInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Req() req: AppRequest,
  ) {
    return this.years.create(t.tenantId, auth.userId, body, clientIp(req));
  }
}
