import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AcademicYearsModule } from './academic-years/academic-years.module';
import { AcademicsModule } from './academics/academics.module';
import { AdminModule } from './admin/admin.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { SessionGuard } from './auth/session.guard';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { StaffModule } from './staff/staff.module';
import { StudentsModule } from './students/students.module';
import { TenantsModule } from './tenants/tenants.module';
import { TimetableModule } from './timetable/timetable.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    TenantsModule,
    AcademicYearsModule,
    AcademicsModule,
    StudentsModule,
    StaffModule,
    TimetableModule,
    AttendanceModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limiting runs before session resolution.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
