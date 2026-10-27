import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { TenantContextController } from './tenant-context.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [PlatformTenantsController, TenantContextController],
  providers: [TenantsService, ExportService],
})
export class TenantsModule {}
