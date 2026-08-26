import type { FetchFn } from '../foundation/api-client';

export const browserFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return {
    status: res.status,
    json: async () => {
      try {
        return await res.json();
      } catch {
        return {};
      }
    },
  };
};
