import { Global, Module } from '@nestjs/common';
import { SchoolController } from './school.controller';
import { SchoolProfileService } from './school-profile.service';

/** Global: report cards, receipts, payslips and certificates all print the school's letterhead. */
@Global()
@Module({
  controllers: [SchoolController],
  providers: [SchoolProfileService],
  exports: [SchoolProfileService],
})
export class SchoolProfileModule {}
