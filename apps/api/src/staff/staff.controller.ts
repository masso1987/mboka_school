import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  endAssignmentSchema,
  staffSchema,
  teachingAssignmentSchema,
  type EndAssignmentInput,
  type StaffInput,
  type TeachingAssignmentInput,
} from '@mboka/shared';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { todayIn } from '../common/dates';
import { type ListQuery, ListQueryParams } from '../common/pagination';
import { ApiZodBody, ZodBody } from '../common/zod';
import { StaffService } from './staff.service';

const optionalUuid = new ParseUUIDPipe({ optional: true });

@ApiTags('staff')
@Controller()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('staff')
  @RequirePermissions('hr.staff.read')
  list(@CurrentActor() a: Actor, @ListQueryParams() q: ListQuery, @Query('teachersOnly') teachersOnly?: string) {
    return this.staff.list(a, { ...q, teachersOnly: teachersOnly === 'true' });
  }

  @Post('staff')
  @RequirePermissions('hr.staff.manage')
  @ApiZodBody(staffSchema)
  create(@CurrentActor() a: Actor, @ZodBody(staffSchema) body: StaffInput) {
    return this.staff.create(a, body);
  }

  @Get('teaching-assignments')
  @RequirePermissions('academics.years.read')
  listAssignments(
    @CurrentActor() a: Actor,
    @Query('academicYearId', optionalUuid) academicYearId?: string,
    @Query('staffId', optionalUuid) staffId?: string,
    @Query('classId', optionalUuid) classId?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.staff.listAssignments(a, {
      academicYearId,
      staffId,
      classId,
      activeOn: activeOnly === 'true' ? todayIn(a.timezone) : undefined,
    });
  }

  /** Any member: returns their own staff record and current assignments (empty if not staff). */
  @Get('me/assignments')
  @RequirePermissions()
  mine(@CurrentActor() a: Actor) {
    return this.staff.myAssignments(a, todayIn(a.timezone));
  }

  @Post('teaching-assignments')
  @RequirePermissions('academics.assignments.manage')
  @ApiZodBody(teachingAssignmentSchema)
  assign(@CurrentActor() a: Actor, @ZodBody(teachingAssignmentSchema) body: TeachingAssignmentInput) {
    return this.staff.assign(a, body);
  }

  @Post('teaching-assignments/:id/end')
  @HttpCode(200)
  @RequirePermissions('academics.assignments.manage')
  @ApiZodBody(endAssignmentSchema)
  end(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(endAssignmentSchema) body: EndAssignmentInput) {
    return this.staff.endAssignment(a, id, body);
  }
}
