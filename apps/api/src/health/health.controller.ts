import { Controller, Get, Headers, NotFoundException, Res, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators';
import { metrics } from '../common/observability';
import { PrismaService } from '../prisma/prisma.service';

/** Probes for the orchestrator and metrics for monitoring (spec §12.3). */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process answers. Never touches the database, so a DB outage does not restart the API. */
  @Public()
  @SkipThrottle()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: the database answers; traffic should only be routed when this is 200. */
  @Public()
  @SkipThrottle()
  @Get(['', 'ready'])
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE', message: 'Database unreachable' });
    }
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** Prometheus text format; requires `Authorization: Bearer <METRICS_TOKEN>`; 404 when no token is configured. */
  @Public()
  @SkipThrottle()
  @Get('metrics')
  metrics(@Headers('authorization') authorization: string | undefined, @Res() res: Response) {
    const token = process.env.METRICS_TOKEN;
    const given = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) throw new NotFoundException();
    res.type('text/plain; version=0.0.4').send(metrics.render());
  }
}
