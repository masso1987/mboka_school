import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createTenantSchema,
  tenantStatusSchema,
  type CreateTenantInput,
  type TenantStatusInput,
} from '@mboka/shared';
import { PlatformAdmin } from '../auth/decorators';
import { type AppRequest, type AuthContext, clientIp, CurrentAuth } from '../common/request-context';
import { ApiZodBody, ZodBody } from '../common/zod';
import { TenantsService } from './tenants.service';

/** SaaS provisioning (Module 1). Platform admins manage tenants but get no school-data access from this. */
@ApiTags('platform')
@PlatformAdmin()
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  @ApiZodBody(createTenantSchema)
  create(@ZodBody(createTenantSchema) body: CreateTenantInput, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.tenants.create(body, auth.userId, clientIp(req));
  }

  @Patch(':id/status')
  @ApiZodBody(tenantStatusSchema)
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(tenantStatusSchema) body: TenantStatusInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.tenants.setStatus(id, body, auth.userId, clientIp(req));
  }
}
