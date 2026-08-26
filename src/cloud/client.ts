import http from 'http';
import type { ControlPlaneEnv } from './env';

export class CloudReadCache {
  private data = new Map<string, { at: number; value: unknown }>();
  constructor(private ttlMs = 5000) {}
  get<T>(key: string): T | undefined {
    const hit = this.data.get(key);
    if (!hit || Date.now() - hit.at > this.ttlMs) return undefined;
    return hit.value as T;
  }
  set(key: string, value: unknown): void {
    this.data.set(key, { at: Date.now(), value });
  }
  clear(): void {
    this.data.clear();
  }
}

/** HTTP client. Optional cache is never the source of truth. */
export class ControlPlaneClient {
  token?: string;
  refreshToken?: string;
  workerToken?: string;
  userAgent: string;
  readonly cache = new CloudReadCache();

  constructor(
    public baseUrl: string,
    options?: { userAgent?: string }
  ) {
    this.userAgent = options?.userAgent || 'Mascayl-Client/windows';
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extra?: { idempotencyKey?: string; worker?: boolean; skipAuth?: boolean; headers?: Record<string, string> }
  ): Promise<{ status: number; data: T }> {
    const url = new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': this.userAgent,
      ...(extra?.headers || {}),
    };
    if (extra?.worker && this.workerToken) headers.authorization = `Worker ${this.workerToken}`;
    else if (this.token && !extra?.skipAuth) headers.authorization = `Bearer ${this.token}`;
    if (extra?.idempotencyKey) headers['idempotency-key'] = extra.idempotencyKey;
    const payload = body ? JSON.stringify(body) : undefined;
    const data = await new Promise<{ status: number; data: T }>((resolve, reject) => {
      const req = http.request(
        url,
        { method, headers: { ...headers, 'content-length': String(Buffer.byteLength(payload || '')) } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c as Buffer));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let parsed: T = (raw ? JSON.parse(raw) : {}) as T;
            resolve({ status: res.statusCode || 500, data: parsed });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
    return data;
  }

  async health() {
    return this.request('GET', '/health', undefined, { skipAuth: true });
  }
  async ready() {
    return this.request('GET', '/ready', undefined, { skipAuth: true });
  }
  async contract() {
    return this.request('GET', '/contract', undefined, { skipAuth: true });
  }
}

export type { ControlPlaneEnv };
