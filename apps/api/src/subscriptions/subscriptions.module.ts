import { Module } from '@nestjs/common';
import { SignupService } from './signup.service';
import { PlatformSubscriptionsController, SignupController, SubscriptionController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  controllers: [SignupController, SubscriptionController, PlatformSubscriptionsController],
  providers: [SignupService, SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
