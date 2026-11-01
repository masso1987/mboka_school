import { Global, Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { GradesModule } from '../grades/grades.module';
import { AnnouncementsService } from './announcements.service';
import { CommunityController } from './community.controller';
import { InsightsService } from './insights.service';
import { NotificationsService } from './notifications.service';
import { PortalService } from './portal.service';

/** Notifications are used by attendance, grades and HR; kept in a dependency-free global module. */
@Global()
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

@Module({
  imports: [FinanceModule, GradesModule],
  controllers: [CommunityController],
  providers: [AnnouncementsService, PortalService, InsightsService],
})
export class CommunityModule {}
