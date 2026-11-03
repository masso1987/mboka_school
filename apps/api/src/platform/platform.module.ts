import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DashboardService } from './dashboard.service';
import { PlatformAdminsService } from './platform-admins.service';
import { PlatformController } from './platform.controller';
import { SchoolsService } from './schools.service';

/** Platform console (Phase 7). */
@Module({
  imports: [AdminModule, SubscriptionsModule],
  controllers: [PlatformController],
  providers: [DashboardService, SchoolsService, PlatformAdminsService],
})
export class PlatformModule {}
