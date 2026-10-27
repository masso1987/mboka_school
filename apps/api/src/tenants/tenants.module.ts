import { Module } from '@nestjs/common';
import { PlatformTenantsController } from './platform-tenants.controller';
import { TenantContextController } from './tenant-context.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [PlatformTenantsController, TenantContextController],
  providers: [TenantsService],
})
export class TenantsModule {}
