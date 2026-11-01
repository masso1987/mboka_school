import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  campusSchema,
  inviteUserSchema,
  membershipStatusSchema,
  userRolesSchema,
  type CampusInput,
  type InviteUserInput,
  type MembershipStatusInput,
  type UserRolesInput,
} from '@mboka/shared';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { ApiZodBody, ZodBody } from '../common/zod';
import { AdminService } from './admin.service';

@ApiTags('administration')
@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('campuses')
  @RequirePermissions()
  listCampuses(@CurrentActor() a: Actor) {
    return this.admin.listCampuses(a);
  }

  @Post('campuses')
  @RequirePermissions('tenant.campuses.manage')
  @ApiZodBody(campusSchema)
  createCampus(@CurrentActor() a: Actor, @ZodBody(campusSchema) body: CampusInput) {
    return this.admin.createCampus(a, body);
  }

  @Get('roles')
  @RequirePermissions('users.read')
  listRoles(@CurrentActor() a: Actor) {
    return this.admin.listRoles(a);
  }

  @Get('users')
  @RequirePermissions('users.read')
  listUsers(@CurrentActor() a: Actor) {
    return this.admin.listUsers(a);
  }

  @Post('users')
  @RequirePermissions('users.invite', 'users.permissions.manage')
  @ApiZodBody(inviteUserSchema)
  invite(@CurrentActor() a: Actor, @ZodBody(inviteUserSchema) body: InviteUserInput) {
    return this.admin.invite(a, body);
  }

  @Put('users/:membershipId/roles')
  @RequirePermissions('users.permissions.manage')
  @ApiZodBody(userRolesSchema)
  setRoles(
    @CurrentActor() a: Actor,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @ZodBody(userRolesSchema) body: UserRolesInput,
  ) {
    return this.admin.setRoles(a, membershipId, body);
  }

  @Post('users/:membershipId/status')
  @HttpCode(200)
  @RequirePermissions('users.permissions.manage')
  @ApiZodBody(membershipStatusSchema)
  setStatus(
    @CurrentActor() a: Actor,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @ZodBody(membershipStatusSchema) body: MembershipStatusInput,
  ) {
    return this.admin.setMembershipStatus(a, membershipId, body);
  }
}
