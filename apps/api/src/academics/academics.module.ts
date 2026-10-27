import { Module } from '@nestjs/common';
import { AcademicsController } from './academics.controller';
import { AcademicsService } from './academics.service';
import { RolloverService } from './rollover.service';

@Module({
  controllers: [AcademicsController],
  providers: [AcademicsService, RolloverService],
})
export class AcademicsModule {}
