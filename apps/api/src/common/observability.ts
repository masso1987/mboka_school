import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Request ids, access logs and Prometheus metrics (spec §12.3), without dependencies.
 * Logs carry method, route template, status, duration, request id and tenant id — never bodies,
 * query strings or personal data (§11.3).
 */
const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5, 5];

class Metrics {
  private readonly counts = new Map<string, number>();
  private readonly histograms = new Map<string, { buckets: number[]; sum: number; count: number }>();
  readonly startedAt = Date.now();

  observe(method: string, route: string, status: number, seconds: number) {
    const key = `${method}|${route}|${status}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    const hk = `${method}|${route}`;
    const h = this.histograms.get(hk) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) h.buckets[i]!++;
    });
    h.sum += seconds;
    h.count++;
    this.histograms.set(hk, h);
  }

  render(): string {
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const lines = [
      '# HELP mboka_http_requests_total HTTP requests by method, route and status.',
      '# TYPE mboka_http_requests_total counter',
    ];
    for (const [k, v] of this.counts) {
      const [method, route, status] = k.split('|');
      lines.push(`mboka_http_requests_total{method="${method}",route="${esc(route!)}",status="${status}"} ${v}`);
    }
    lines.push('# HELP mboka_http_request_duration_seconds Request duration.', '# TYPE mboka_http_request_duration_seconds histogram');
    for (const [k, h] of this.histograms) {
      const [method, route] = k.split('|');
      const labels = `method="${method}",route="${esc(route!)}"`;
      BUCKETS.forEach((b, i) => lines.push(`mboka_http_request_duration_seconds_bucket{${labels},le="${b}"} ${h.buckets[i]}`));
      lines.push(`mboka_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`);
      lines.push(`mboka_http_request_duration_seconds_sum{${labels}} ${h.sum.toFixed(6)}`);
      lines.push(`mboka_http_request_duration_seconds_count{${labels}} ${h.count}`);
    }
    const mem = process.memoryUsage();
    lines.push(
      '# TYPE mboka_process_uptime_seconds gauge',
      `mboka_process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(0)}`,
      '# TYPE mboka_process_resident_memory_bytes gauge',
      `mboka_process_resident_memory_bytes ${mem.rss}`,
      '# TYPE mboka_process_heap_used_bytes gauge',
      `mboka_process_heap_used_bytes ${mem.heapUsed}`,
    );
    return lines.join('\n') + '\n';
  }
}

export const metrics = new Metrics();
const access = new Logger('Access');
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestContextMiddleware(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    // Route template (e.g. /api/v1/students/:id), never the concrete URL with ids or query strings.
    const route = req.route?.path ? `${req.baseUrl}${req.route.path as string}` : 'unmatched';
    metrics.observe(req.method, route, res.statusCode, seconds);
    if (process.env.ACCESS_LOG !== 'off') {
      access.log(
        JSON.stringify({
          rid: id,
          method: req.method,
          route,
          status: res.statusCode,
          ms: Math.round(seconds * 1000),
          tenant: req.header('x-tenant-id') ?? undefined,
        }),
      );
    }
  });
  next();
}
