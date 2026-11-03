import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ActivityService } from './activity.service';
import { CommunicationService } from './communication.service';
import { DashboardService } from './dashboard.service';
import { DemoService } from './demo.service';
import { PlatformAdminsService } from './platform-admins.service';
import { PlatformController } from './platform.controller';
import { PublicPlatformController } from './public.controller';
import { PricingService } from './pricing.service';
import { SchoolsService } from './schools.service';
import { SystemService } from './system.service';

/** Platform console (Phase 7). */
@Module({
  imports: [AdminModule, SubscriptionsModule],
  controllers: [PlatformController, PublicPlatformController],
  providers: [DashboardService, SchoolsService, PlatformAdminsService, ActivityService, PricingService, CommunicationService, DemoService, SystemService],
  exports: [CommunicationService],
})
export class PlatformModule {}
