import { Module } from '@nestjs/common';
import { GradesController } from './grades.controller';
import { GradesService } from './grades.service';
import { ReportCardsService } from './report-cards.service';

@Module({
  controllers: [GradesController],
  providers: [GradesService, ReportCardsService],
  exports: [ReportCardsService],
})
export class GradesModule {}
