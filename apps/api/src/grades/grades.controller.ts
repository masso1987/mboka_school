import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  assessmentSchema,
  commentsSchema,
  marksImportSchema,
  marksSchema,
  promotionSchema,
  reportScopeSchema,
  schemeRulesSchema,
  sheetDecisionSchema,
  sheetRefSchema,
  type AssessmentInput,
  type CommentsInput,
  type MarksImportInput,
  type MarksInput,
  type PromotionInput,
  type ReportScope,
  type SchemeRulesInput,
  type SheetDecisionInput,
  type SheetRef,
} from '@mboka/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { ApiZodBody, ZodBody, ZodPipe } from '../common/zod';
import { GradesService } from './grades.service';
import { ReportCardsService } from './report-cards.service';

const langQuery = z.object({ lang: z.enum(['fr', 'en']).default('fr') });
const overviewQuery = z.object({ classId: z.uuid(), periodId: z.uuid() });
const classQuery = z.object({ classId: z.uuid() });

/**
 * Teachers' access to a sheet depends on their assignment, checked in the service;
 * routes marked @RequirePermissions() only require school membership.
 */
@ApiTags('grades')
@Controller()
export class GradesController {
  constructor(
    private readonly grades: GradesService,
    private readonly cards: ReportCardsService,
  ) {}

  // ------------------------------------------------------------ scheme

  @Get('grading/scheme')
  @RequirePermissions('academics.years.read')
  scheme(@CurrentActor() a: Actor) {
    return this.grades.getScheme(a);
  }

  @Put('grading/scheme')
  @RequirePermissions('academics.structure.manage')
  @ApiZodBody(schemeRulesSchema)
  updateScheme(@CurrentActor() a: Actor, @ZodBody(schemeRulesSchema) body: SchemeRulesInput) {
    return this.grades.updateScheme(a, body);
  }

  // ------------------------------------------------------------ assessments and sheets

  @Post('assessments')
  @RequirePermissions()
  @ApiZodBody(assessmentSchema)
  createAssessment(@CurrentActor() a: Actor, @ZodBody(assessmentSchema) body: AssessmentInput) {
    return this.grades.createAssessment(a, body);
  }

  @Delete('assessments/:id')
  @HttpCode(204)
  @RequirePermissions()
  async deleteAssessment(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.grades.deleteAssessment(a, id);
  }

  @Get('grade-sheets')
  @RequirePermissions()
  sheet(@CurrentActor() a: Actor, @Query(new ZodPipe(sheetRefSchema)) q: SheetRef) {
    return this.grades.sheet(a, q);
  }

  @Put('grade-sheets/marks')
  @RequirePermissions()
  @ApiZodBody(marksSchema)
  saveMarks(@CurrentActor() a: Actor, @ZodBody(marksSchema) body: MarksInput) {
    return this.grades.saveMarks(a, body);
  }

  @Post('grade-sheets/import')
  @HttpCode(200)
  @RequirePermissions()
  @ApiZodBody(marksImportSchema)
  importMarks(@CurrentActor() a: Actor, @ZodBody(marksImportSchema) body: MarksImportInput) {
    return this.grades.importMarks(a, body);
  }

  @Put('grade-sheets/comments')
  @RequirePermissions()
  @ApiZodBody(commentsSchema)
  saveComments(@CurrentActor() a: Actor, @ZodBody(commentsSchema) body: CommentsInput) {
    return this.grades.saveComments(a, body);
  }

  @Post('grade-sheets/submit')
  @HttpCode(200)
  @RequirePermissions('grades.submit')
  @ApiZodBody(sheetRefSchema)
  submit(@CurrentActor() a: Actor, @ZodBody(sheetRefSchema) body: SheetRef) {
    return this.grades.submit(a, body);
  }

  @Post('grade-sheets/approve')
  @HttpCode(200)
  @RequirePermissions('grades.approve')
  @ApiZodBody(sheetRefSchema)
  approve(@CurrentActor() a: Actor, @ZodBody(sheetRefSchema) body: SheetRef) {
    return this.grades.approve(a, body);
  }

  @Post('grade-sheets/return')
  @HttpCode(200)
  @RequirePermissions('grades.approve')
  @ApiZodBody(sheetDecisionSchema)
  returnSheet(@CurrentActor() a: Actor, @ZodBody(sheetDecisionSchema) body: SheetDecisionInput) {
    return this.grades.returnToTeacher(a, body);
  }

  @Post('grade-sheets/reopen')
  @HttpCode(200)
  @RequirePermissions('grades.reopen')
  @ApiZodBody(sheetDecisionSchema)
  reopen(@CurrentActor() a: Actor, @ZodBody(sheetDecisionSchema) body: SheetDecisionInput) {
    return this.grades.reopen(a, body);
  }

  @Get('grade-sheets/overview')
  @RequirePermissions('grades.approve')
  overview(@CurrentActor() a: Actor, @Query(new ZodPipe(overviewQuery)) q: z.infer<typeof overviewQuery>) {
    return this.grades.overview(a, q.classId, q.periodId);
  }

  // ------------------------------------------------------------ report cards

  @Post('report-cards/generate')
  @HttpCode(200)
  @RequirePermissions('grades.approve')
  @ApiZodBody(reportScopeSchema)
  generate(@CurrentActor() a: Actor, @ZodBody(reportScopeSchema) body: ReportScope) {
    return this.cards.generate(a, body.classId, body.scope);
  }

  @Post('report-cards/publish')
  @HttpCode(200)
  @RequirePermissions('reportcards.publish')
  @ApiZodBody(reportScopeSchema)
  publish(@CurrentActor() a: Actor, @ZodBody(reportScopeSchema) body: ReportScope) {
    return this.cards.publish(a, body.classId, body.scope);
  }

  @Get('report-cards')
  @RequirePermissions('grades.approve')
  list(@CurrentActor() a: Actor, @Query(new ZodPipe(reportScopeSchema)) q: ReportScope) {
    return this.cards.list(a, q.classId, q.scope);
  }

  @Get('report-cards/class.pdf')
  @RequirePermissions('grades.approve')
  async classPdf(
    @CurrentActor() a: Actor,
    @Query(new ZodPipe(reportScopeSchema.extend(langQuery.shape))) q: ReportScope & { lang: 'fr' | 'en' },
    @Res() res: Response,
  ) {
    const pdf = await this.cards.pdf(a, { classId: q.classId, scope: q.scope }, q.lang);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="bulletins.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }

  @Get('report-cards/:id')
  @RequirePermissions('grades.approve')
  get(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.get(a, id);
  }

  @Get('report-cards/:id/pdf')
  @RequirePermissions('grades.approve')
  async cardPdf(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(langQuery)) q: z.infer<typeof langQuery>, @Res() res: Response) {
    const pdf = await this.cards.pdf(a, { cardId: id }, q.lang);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="bulletin.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
  }

  @Public()
  @Get('verify/report-cards/:code')
  verify(@Param('code') code: string) {
    return this.cards.verify(code.trim().toUpperCase());
  }

  // ------------------------------------------------------------ promotions and statistics

  @Get('promotions')
  @RequirePermissions('grades.approve')
  proposals(@CurrentActor() a: Actor, @Query(new ZodPipe(classQuery)) q: z.infer<typeof classQuery>) {
    return this.cards.proposePromotions(a, q.classId);
  }

  @Put('promotions')
  @RequirePermissions('grades.approve')
  @ApiZodBody(promotionSchema)
  savePromotions(@CurrentActor() a: Actor, @ZodBody(promotionSchema) body: PromotionInput) {
    return this.cards.savePromotions(a, body);
  }

  @Get('grading/statistics')
  @RequirePermissions('grades.approve')
  statistics(@CurrentActor() a: Actor, @Query(new ZodPipe(reportScopeSchema)) q: ReportScope) {
    return this.cards.statistics(a, q.classId, q.scope);
  }
}
