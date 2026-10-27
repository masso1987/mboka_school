import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  academicPeriodSchema,
  classSubjectSchema,
  educationLevelSchema,
  programSchema,
  schoolClassSchema,
  subjectSchema,
  type AcademicPeriodInput,
  type ClassSubjectInput,
  type EducationLevelInput,
  type ProgramInput,
  type SchoolClassInput,
  type SubjectInput,
} from '@mboka/shared';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { ApiZodBody, ZodBody } from '../common/zod';
import { AcademicsService } from './academics.service';

const READ = 'academics.years.read' as const;
const MANAGE = 'academics.structure.manage' as const;

@ApiTags('academics')
@Controller()
export class AcademicsController {
  constructor(private readonly academics: AcademicsService) {}

  @Get('academic-years/:yearId/periods')
  @RequirePermissions(READ)
  listPeriods(@CurrentActor() a: Actor, @Param('yearId', ParseUUIDPipe) yearId: string) {
    return this.academics.listPeriods(a, yearId);
  }

  @Post('academic-years/:yearId/periods')
  @RequirePermissions('academics.years.manage')
  @ApiZodBody(academicPeriodSchema)
  createPeriod(
    @CurrentActor() a: Actor,
    @Param('yearId', ParseUUIDPipe) yearId: string,
    @ZodBody(academicPeriodSchema) body: AcademicPeriodInput,
  ) {
    return this.academics.createPeriod(a, yearId, body);
  }

  @Get('education-levels')
  @RequirePermissions(READ)
  listLevels(@CurrentActor() a: Actor) {
    return this.academics.listLevels(a);
  }

  @Post('education-levels')
  @RequirePermissions(MANAGE)
  @ApiZodBody(educationLevelSchema)
  createLevel(@CurrentActor() a: Actor, @ZodBody(educationLevelSchema) body: EducationLevelInput) {
    return this.academics.createLevel(a, body);
  }

  @Get('programs')
  @RequirePermissions(READ)
  listPrograms(@CurrentActor() a: Actor) {
    return this.academics.listPrograms(a);
  }

  @Post('programs')
  @RequirePermissions(MANAGE)
  @ApiZodBody(programSchema)
  createProgram(@CurrentActor() a: Actor, @ZodBody(programSchema) body: ProgramInput) {
    return this.academics.createProgram(a, body);
  }

  @Get('subjects')
  @RequirePermissions(READ)
  listSubjects(@CurrentActor() a: Actor) {
    return this.academics.listSubjects(a);
  }

  @Post('subjects')
  @RequirePermissions(MANAGE)
  @ApiZodBody(subjectSchema)
  createSubject(@CurrentActor() a: Actor, @ZodBody(subjectSchema) body: SubjectInput) {
    return this.academics.createSubject(a, body);
  }

  @Get('classes')
  @RequirePermissions(READ)
  listClasses(@CurrentActor() a: Actor, @Query('academicYearId', new ParseUUIDPipe({ optional: true })) yearId?: string) {
    return this.academics.listClasses(a, yearId);
  }

  @Get('classes/:id')
  @RequirePermissions(READ)
  getClass(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.academics.getClass(a, id);
  }

  @Post('classes')
  @RequirePermissions(MANAGE)
  @ApiZodBody(schoolClassSchema)
  createClass(@CurrentActor() a: Actor, @ZodBody(schoolClassSchema) body: SchoolClassInput) {
    return this.academics.createClass(a, body);
  }

  @Post('classes/:id/subjects')
  @RequirePermissions(MANAGE)
  @ApiZodBody(classSubjectSchema)
  addClassSubject(
    @CurrentActor() a: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(classSubjectSchema) body: ClassSubjectInput,
  ) {
    return this.academics.addClassSubject(a, id, body);
  }
}
