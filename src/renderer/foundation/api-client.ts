import { normalizeApiError } from './api-error';
import { getApiBaseUrl, joinUrl } from './env';
import type { TokenStore } from './token-store';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type FetchResponse = {
  status: number;
  json: () => Promise<unknown>;
};

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<FetchResponse>;

export type ApiClientOptions = {
  getEnv?: () => Record<string, string | undefined>;
  tokens: TokenStore;
  getLanguage: () => string;
  fetchFn: FetchFn;
  onSessionCleared?: () => void;
};

export class ApiClient {
  private refreshing: Promise<boolean> | null = null;

  constructor(private options: ApiClientOptions) {}

  get(path: string) {
    return this.request('GET', path);
  }
  post(path: string, body?: unknown) {
    return this.request('POST', path, body);
  }
  put(path: string, body?: unknown) {
    return this.request('PUT', path, body);
  }
  patch(path: string, body?: unknown) {
    return this.request('PATCH', path, body);
  }
  delete(path: string) {
    return this.request('DELETE', path);
  }

  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown, retry = true): Promise<{ status: number; data: T }> {
    const env = this.options.getEnv ? this.options.getEnv() : {};
    const url = joinUrl(getApiBaseUrl(env), path);
    const tokens = this.options.tokens.load();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-language': this.options.getLanguage() || 'es',
    };
    if (tokens.accessToken && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
      headers.authorization = `Bearer ${tokens.accessToken}`;
    }
    if (tokens.tenantId) headers['x-tenant-id'] = tokens.tenantId;
    const res = await this.options.fetchFn(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: unknown = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (res.status === 401 && retry && !path.startsWith('/auth/refresh') && !path.startsWith('/auth/login')) {
      const ok = await this.tryRefresh();
      if (ok) return this.request<T>(method, path, body, false);
      this.options.tokens.clear();
      this.options.onSessionCleared?.();
      throw normalizeApiError(res.status, data);
    }
    if (res.status >= 400) throw normalizeApiError(res.status, data);
    return { status: res.status, data: data as T };
  }

  private tryRefresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const refreshToken = this.options.tokens.load().refreshToken;
      if (!refreshToken) return false;
      try {
        const env = this.options.getEnv ? this.options.getEnv() : {};
        const url = joinUrl(getApiBaseUrl(env), '/auth/refresh');
        const res = await this.options.fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'accept-language': this.options.getLanguage() || 'es' },
          body: JSON.stringify({ refreshToken }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (res.status >= 400) return false;
        const access = String(data.accessToken || data.token || '');
        const nextRefresh = String(data.refreshToken || refreshToken);
        if (!access) return false;
        const prev = this.options.tokens.load();
        this.options.tokens.save({ accessToken: access, refreshToken: nextRefresh, tenantId: prev.tenantId });
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
}
