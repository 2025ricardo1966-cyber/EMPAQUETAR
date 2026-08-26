import { getApiBaseUrl, resolveFrontendEnv } from '../foundation/env';

export function runtimeEnv(): Record<string, string | undefined> {
  const meta = import.meta.env;
  return {
    VITE_API_URL: meta.VITE_API_URL,
    MODE: meta.MODE,
  };
}

export function runtimeApiBaseUrl(): string {
  return getApiBaseUrl(runtimeEnv());
}

export function runtimeIsDev(): boolean {
  return resolveFrontendEnv(import.meta.env.MODE) === 'development';
}
