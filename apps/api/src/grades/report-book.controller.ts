import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { ReportBookService } from './report-book.service';

const langOf = (v?: string) => (v === 'fr' ? 'fr' : 'en');
const layoutOf = (v?: string) => (v === 'PRIMARY_BOOKLET' || v === 'SEQUENCE_BOOK' ? v : undefined);

/** Report books (Phase 8): the school's printed booklet, for one pupil or a whole class. */
@ApiTags('report-books')
@Controller('report-books')
export class ReportBookController {
  constructor(private readonly books: ReportBookService) {}

  @Get('classes/:classId.pdf')
  @RequirePermissions('grades.approve')
  async forClass(@CurrentActor() a: Actor, @Param('classId', ParseUUIDPipe) classId: string, @Query('lang') lang: string | undefined, @Query('layout') layout: string | undefined, @Res() res: Response) {
    const { file, name } = await this.books.pdf(a, { classId }, langOf(lang), layoutOf(layout));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'no-store' }).send(file);
  }

  @Get('enrollments/:enrollmentId.pdf')
  @RequirePermissions('grades.approve')
  async forPupil(@CurrentActor() a: Actor, @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string, @Query('lang') lang: string | undefined, @Query('layout') layout: string | undefined, @Res() res: Response) {
    const { file, name } = await this.books.pdf(a, { enrollmentId }, langOf(lang), layoutOf(layout));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'no-store' }).send(file);
  }
}
