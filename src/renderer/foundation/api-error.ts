export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function statusKind(status: number): 'client' | 'auth' | 'forbidden' | 'not_found' | 'conflict' | 'rate' | 'server' | 'ok' | 'other' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate';
  if (status === 422 || status === 400) return 'client';
  if (status >= 500) return 'server';
  return 'other';
}

export function normalizeApiError(status: number, body: unknown): ApiError {
  const row = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = String(row.code || row.error || `HTTP_${status}`);
  const message = String(row.message || row.error || code);
  const details = row.fields ?? row.details ?? body;
  return new ApiError(status, code, message, details);
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}
