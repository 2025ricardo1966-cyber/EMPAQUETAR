export interface SqlEngine {
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export async function openSqlEngine(databaseUrl?: string): Promise<SqlEngine> {
  if (databaseUrl && /^(postgres(?:ql)?:)/i.test(databaseUrl)) {
    throw new Error(
      'POSTGRES_DRIVER_NOT_WIRED: MASCAYL_DATABASE_URL postgres is reserved for Cloud ORA. Use a filesystem path or pglite: until the pg driver is connected. Do not silently fall back to memory.'
    );
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir =
    databaseUrl && databaseUrl.startsWith('pglite:')
      ? databaseUrl.slice('pglite:'.length)
      : databaseUrl && !databaseUrl.startsWith('postgres')
        ? databaseUrl
        : undefined;
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return {
    async exec(sql: string) {
      await db.exec(sql);
    },
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await db.query<T>(sql, params);
      return (result.rows || []) as T[];
    },
    async ready() {
      await db.query('SELECT 1 AS ok');
      return true;
    },
    async close() {
      await db.close();
    },
  };
}
