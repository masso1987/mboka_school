import type { ApiError } from '@mboka/shared';

/** Error carrying the API's stable code so the UI can translate it. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// Kept in memory only: the CSRF token comes back from /auth/me after every reload.
let csrfToken: string | undefined;
let tenantId: string | undefined;

export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

export function setActiveTenant(id: string | undefined): void {
  tenantId = id;
}

/** Binary download (PDF, CSV) with the same headers as `api`; a plain link could not send X-Tenant-Id. */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`/api/v1${path}`, {
    headers: tenantId ? { 'X-Tenant-Id': tenantId } : {},
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const err = ((await res.json().catch(() => undefined)) as ApiError | undefined)?.error;
    throw new ApiRequestError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? res.statusText);
  }
  return res.blob();
}

/** Opens a downloaded document in a new tab (the browser's PDF viewer prints and saves it). */
export async function openBlob(path: string): Promise<void> {
  const url = URL.createObjectURL(await apiBlob(path));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (data as ApiError | undefined)?.error;
    throw new ApiRequestError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? res.statusText, err?.details);
  }
  return data as T;
}
