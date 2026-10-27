import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { attendanceSubmitSchema, isoDate, type AttendanceSubmitInput } from '@mboka/shared';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { ApiZodBody, ZodBody, ZodPipe } from '../common/zod';
import { AttendanceService } from './attendance.service';

const registerQuery = z.object({
  classId: z.uuid(),
  date: isoDate,
  slot: z.string().trim().min(1).max(40).default('DAY'),
});

const summaryQuery = z.object({ classId: z.uuid(), from: isoDate, to: isoDate });

/** Access is decided per class in the service (assigned teacher vs. attendance.read/correct). */
@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('register')
  @RequirePermissions()
  register(@CurrentActor() a: Actor, @Query(new ZodPipe(registerQuery)) q: z.infer<typeof registerQuery>) {
    return this.attendance.register(a, q.classId, q.date, q.slot);
  }

  @Post('submit')
  @HttpCode(200)
  @RequirePermissions()
  @ApiZodBody(attendanceSubmitSchema)
  submit(@CurrentActor() a: Actor, @ZodBody(attendanceSubmitSchema) body: AttendanceSubmitInput) {
    return this.attendance.submit(a, body);
  }

  @Get('summary')
  @RequirePermissions()
  summary(@CurrentActor() a: Actor, @Query(new ZodPipe(summaryQuery)) q: z.infer<typeof summaryQuery>) {
    return this.attendance.summary(a, q.classId, q.from, q.to);
  }
}
