import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  admissionDecisionSchema,
  admissionSchema,
  classChangeSchema,
  enrollmentExitSchema,
  enrollmentSchema,
  guardianLinkSchema,
  studentSchema,
  studentUpdateSchema,
  type AdmissionDecisionInput,
  type AdmissionInput,
  type ClassChangeInput,
  type EnrollmentExitInput,
  type EnrollmentInput,
  type GuardianLinkInput,
  type StudentInput,
  type StudentUpdateInput,
} from '@mboka/shared';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { type ListQuery, ListQueryParams } from '../common/pagination';
import { ApiZodBody, ZodBody } from '../common/zod';
import { EnrollmentsService } from './enrollments.service';
import { StudentsService } from './students.service';

@ApiTags('students')
@Controller()
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  @Get('students')
  @RequirePermissions('students.read')
  list(
    @CurrentActor() a: Actor,
    @ListQueryParams() q: ListQuery,
    @Query('classId', new ParseUUIDPipe({ optional: true })) classId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.students.list(a, { ...q, classId, includeArchived: includeArchived === 'true' });
  }

  @Get('students/:id')
  @RequirePermissions('students.read')
  get(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.get(a, id);
  }

  @Post('students')
  @RequirePermissions('students.create')
  @ApiZodBody(studentSchema)
  create(@CurrentActor() a: Actor, @ZodBody(studentSchema) body: StudentInput) {
    return this.students.create(a, body);
  }

  @Patch('students/:id')
  @RequirePermissions('students.update')
  @ApiZodBody(studentUpdateSchema)
  update(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(studentUpdateSchema) body: StudentUpdateInput) {
    return this.students.update(a, id, body);
  }

  @Post('students/:id/archive')
  @HttpCode(200)
  @RequirePermissions('students.archive')
  archive(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.archive(a, id);
  }

  @Post('students/:id/guardians')
  @RequirePermissions('students.update')
  @ApiZodBody(guardianLinkSchema)
  linkGuardian(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(guardianLinkSchema) body: GuardianLinkInput) {
    return this.students.linkGuardian(a, id, body);
  }

  @Delete('students/:id/guardians/:guardianId')
  @HttpCode(204)
  @RequirePermissions('students.update')
  async unlinkGuardian(
    @CurrentActor() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
  ): Promise<void> {
    await this.students.unlinkGuardian(a, id, guardianId);
  }

  @Get('guardians')
  @RequirePermissions('students.read')
  searchGuardians(@CurrentActor() a: Actor, @Query('q') q = '') {
    return this.students.searchGuardians(a, q);
  }

  // ------------------------------------------------------------ admissions

  @Get('admissions')
  @RequirePermissions('admissions.manage')
  listAdmissions(@CurrentActor() a: Actor, @Query('academicYearId', new ParseUUIDPipe({ optional: true })) yearId?: string) {
    return this.enrollments.listAdmissions(a, yearId);
  }

  @Post('admissions')
  @RequirePermissions('admissions.manage')
  @ApiZodBody(admissionSchema)
  createAdmission(@CurrentActor() a: Actor, @ZodBody(admissionSchema) body: AdmissionInput) {
    return this.enrollments.createAdmission(a, body);
  }

  @Post('admissions/:id/decision')
  @HttpCode(200)
  @RequirePermissions('admissions.manage')
  @ApiZodBody(admissionDecisionSchema)
  decide(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(admissionDecisionSchema) body: AdmissionDecisionInput) {
    return this.enrollments.decideAdmission(a, id, body);
  }

  // ------------------------------------------------------------ enrollments

  @Get('classes/:id/enrollments')
  @RequirePermissions('students.read')
  classRoster(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.enrollments.listByClass(a, id);
  }

  @Post('enrollments')
  @RequirePermissions('enrollments.manage')
  @ApiZodBody(enrollmentSchema)
  enroll(@CurrentActor() a: Actor, @ZodBody(enrollmentSchema) body: EnrollmentInput) {
    return this.enrollments.enroll(a, body);
  }

  @Post('enrollments/:id/exit')
  @HttpCode(200)
  @RequirePermissions('enrollments.manage')
  @ApiZodBody(enrollmentExitSchema)
  exit(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(enrollmentExitSchema) body: EnrollmentExitInput) {
    return this.enrollments.exit(a, id, body);
  }

  @Post('enrollments/:id/change-class')
  @RequirePermissions('enrollments.manage')
  @ApiZodBody(classChangeSchema)
  changeClass(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(classChangeSchema) body: ClassChangeInput) {
    return this.enrollments.changeClass(a, id, body);
  }
}
