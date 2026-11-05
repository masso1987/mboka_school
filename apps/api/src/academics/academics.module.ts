import { Module } from '@nestjs/common';
import { AcademicsController } from './academics.controller';
import { AcademicsService } from './academics.service';
import { BookListsController } from './book-lists.controller';
import { BookListsService } from './book-lists.service';
import { RolloverService } from './rollover.service';

@Module({
  controllers: [AcademicsController, BookListsController],
  providers: [AcademicsService, RolloverService, BookListsService],
})
export class AcademicsModule {}
