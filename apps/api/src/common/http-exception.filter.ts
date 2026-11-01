import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiError } from '@mboka/shared';
import type { Response } from 'express';

/** Renders every error as the shared ApiError envelope and keeps internals out of responses. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<{ requestId?: string }>();
    const [status, body] = toApiError(exception);
    if (status >= 500) {
      // Log the error type and stack only — never request bodies, which may hold student data.
      this.logger.error(`rid=${req.requestId ?? '-'} ${exception instanceof Error ? exception.stack : String(exception)}`);
      // The request id lets support find this exact failure in the logs.
      (body.error as { requestId?: string }).requestId = req.requestId;
    }
    res.status(status).json(body);
  }
}

export function toApiError(exception: unknown): [number, ApiError] {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const r = exception.getResponse();
    if (typeof r === 'object' && r !== null && 'code' in r) {
      const { code, message, details } = r as { code: string; message: string; details?: unknown };
      return [status, { error: { code, message, ...(details !== undefined && { details }) } }];
    }
    const message = typeof r === 'string' ? r : exception.message;
    return [status, { error: { code: HttpStatus[status] ?? 'ERROR', message } }];
  }
  return [500, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }];
}
