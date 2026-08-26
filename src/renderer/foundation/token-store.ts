export type SessionTokens = {
  accessToken: string | null;
  refreshToken: string | null;
  tenantId: string | null;
};

export interface TokenStore {
  load(): SessionTokens;
  save(tokens: SessionTokens): void;
  clear(): void;
}

const KEY = 'mascayl.session.v1';

export class MemoryTokenStore implements TokenStore {
  private tokens: SessionTokens = { accessToken: null, refreshToken: null, tenantId: null };
  load() {
    return { ...this.tokens };
  }
  save(tokens: SessionTokens) {
    this.tokens = { ...tokens };
  }
  clear() {
    this.tokens = { accessToken: null, refreshToken: null, tenantId: null };
  }
}

type SimpleStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function webStorage(): SimpleStorage | null {
  const g = globalThis as unknown as { sessionStorage?: SimpleStorage };
  return g.sessionStorage || null;
}

export class WebTokenStore implements TokenStore {
  load(): SessionTokens {
    try {
      const raw = webStorage()?.getItem(KEY);
      if (!raw) return { accessToken: null, refreshToken: null, tenantId: null };
      const parsed = JSON.parse(raw) as SessionTokens;
      return {
        accessToken: parsed.accessToken || null,
        refreshToken: parsed.refreshToken || null,
        tenantId: parsed.tenantId || null,
      };
    } catch {
      return { accessToken: null, refreshToken: null, tenantId: null };
    }
  }
  save(tokens: SessionTokens): void {
    webStorage()?.setItem(KEY, JSON.stringify(tokens));
  }
  clear(): void {
    webStorage()?.removeItem(KEY);
  }
}
