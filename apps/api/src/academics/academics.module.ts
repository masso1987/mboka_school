import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AcademicsController } from './academics.controller';
import { AcademicsService } from './academics.service';
import { BookListsController } from './book-lists.controller';
import { BookListsService } from './book-lists.service';
import { RolloverService } from './rollover.service';

@Module({
  imports: [FinanceModule],
  controllers: [AcademicsController, BookListsController],
  providers: [AcademicsService, RolloverService, BookListsService],
})
export class AcademicsModule {}
