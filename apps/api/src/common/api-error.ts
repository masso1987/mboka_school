import { HttpException, HttpStatus } from '@nestjs/common';

/** Throw with a stable machine-readable code; the filter renders the shared ApiError envelope. */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  unauthenticated: () => new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required'),
  invalidCredentials: () => new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid email or password'),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message),
  csrf: () => new ApiException(HttpStatus.FORBIDDEN, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token'),
  tenantRequired: () => new ApiException(HttpStatus.BAD_REQUEST, 'TENANT_REQUIRED', 'X-Tenant-Id header is required'),
  tenantSuspended: () => new ApiException(HttpStatus.FORBIDDEN, 'TENANT_SUSPENDED', 'This school account is suspended'),
  notFound: (what = 'Resource') => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`),
  conflict: (code: string, message: string) => new ApiException(HttpStatus.CONFLICT, code, message),
  validation: (details: unknown) =>
    new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Request validation failed', details),
};
