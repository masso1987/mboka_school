import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { PlatformAdminGuard } from './platform-admin.guard';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { TenantGuard } from './tenant.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [SessionService, SessionGuard, TenantGuard, PlatformAdminGuard],
  exports: [SessionService, SessionGuard, TenantGuard, PlatformAdminGuard],
})
export class AuthModule {}
