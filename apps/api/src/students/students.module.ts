import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { EnrollmentsService } from './enrollments.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [FinanceModule],
  controllers: [StudentsController],
  providers: [StudentsService, EnrollmentsService],
  exports: [EnrollmentsService],
})
export class StudentsModule {}
