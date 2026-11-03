import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  competenceComponentsSchema,
  competenceMarksSchema,
  competenceRulesSchema,
  type CompetenceComponentsInput,
  type CompetenceMarksInput,
  type CompetenceRules,
} from '@mboka/shared';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { Errors } from '../common/api-error';
import { ApiZodBody, ZodBody } from '../common/zod';
import { CompetencesService } from './competences.service';

const levelSystemSchema = z.object({ markingSystem: z.enum(['SUBJECTS', 'COMPETENCES']) });
const remarksSchema = z.object({
  teacherRemark: z.string().trim().max(500).nullable(),
  headRemark: z.string().trim().max(500).nullable(),
  conduct: z.string().trim().max(120).nullable(),
});

/** Competence-based marking (Phase 8): components, monthly marks, results, report book remarks, thresholds. */
@ApiTags('competences')
@Controller('competences')
export class CompetencesController {
  constructor(private readonly competences: CompetencesService) {}

  @Get('rules')
  @RequirePermissions('grades.enter')
  rules(@CurrentActor() a: Actor) {
    return this.competences.rules(a);
  }

  @Put('rules')
  @RequirePermissions('tenant.settings.update')
  @ApiZodBody(competenceRulesSchema)
  setRules(@CurrentActor() a: Actor, @ZodBody(competenceRulesSchema) body: CompetenceRules) {
    return this.competences.setRules(a, body);
  }

  @Put('levels/:levelId')
  @RequirePermissions('academics.structure.manage')
  @ApiZodBody(levelSystemSchema)
  setLevel(@CurrentActor() a: Actor, @Param('levelId', ParseUUIDPipe) levelId: string, @ZodBody(levelSystemSchema) body: z.infer<typeof levelSystemSchema>) {
    return this.competences.setLevelSystem(a, levelId, body.markingSystem);
  }

  @Get('classes/:classId')
  @RequirePermissions('grades.enter')
  classCompetences(@CurrentActor() a: Actor, @Param('classId', ParseUUIDPipe) classId: string) {
    return this.competences.classCompetences(a, classId);
  }

  @Get('classes/:classId/results')
  @RequirePermissions('grades.approve')
  results(@CurrentActor() a: Actor, @Param('classId', ParseUUIDPipe) classId: string) {
    return this.competences.classResults(a, classId);
  }

  @Put('class-subjects/:id/components')
  @RequirePermissions('academics.structure.manage')
  @ApiZodBody(competenceComponentsSchema)
  setComponents(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(competenceComponentsSchema) body: CompetenceComponentsInput) {
    return this.competences.setComponents(a, id, body);
  }

  @Get('class-subjects/:id/months/:month')
  @RequirePermissions('grades.enter')
  month(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('month', ParseIntPipe) month: number) {
    if (month < 1 || month > 9) throw Errors.notFound('Month');
    return this.competences.monthSheet(a, id, month);
  }

  @Put('marks')
  @RequirePermissions('grades.enter')
  @ApiZodBody(competenceMarksSchema)
  saveMarks(@CurrentActor() a: Actor, @ZodBody(competenceMarksSchema) body: CompetenceMarksInput) {
    return this.competences.saveMonth(a, body);
  }

  @Get('report-books/:enrollmentId/remarks')
  @RequirePermissions('grades.enter')
  remarks(@CurrentActor() a: Actor, @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string) {
    return this.competences.remarks(a, enrollmentId);
  }

  /** Term 1–3, or 0 for the year. */
  @Put('report-books/:enrollmentId/remarks/:term')
  @RequirePermissions('grades.enter')
  @ApiZodBody(remarksSchema)
  setRemarks(
    @CurrentActor() a: Actor,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Param('term', ParseIntPipe) term: number,
    @ZodBody(remarksSchema) body: z.infer<typeof remarksSchema>,
  ) {
    if (term < 0 || term > 3) throw Errors.notFound('Term');
    return this.competences.setRemarks(a, enrollmentId, term, body);
  }
}
