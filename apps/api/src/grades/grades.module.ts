import { Module } from '@nestjs/common';
import { CompetencesController } from './competences.controller';
import { CompetencesService } from './competences.service';
import { GradesController } from './grades.controller';
import { GradesService } from './grades.service';
import { ReportBookController } from './report-book.controller';
import { ReportBookService } from './report-book.service';
import { ReportCardsService } from './report-cards.service';

@Module({
  controllers: [GradesController, CompetencesController, ReportBookController],
  providers: [GradesService, ReportCardsService, CompetencesService, ReportBookService],
  exports: [ReportCardsService],
})
export class GradesModule {}
