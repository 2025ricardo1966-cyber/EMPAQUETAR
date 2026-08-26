import type { SqlEngine } from './engine';
import { CONTROL_PLANE_MIGRATIONS } from './migrations';

export async function applyMigrations(engine: SqlEngine): Promise<string[]> {
  await engine.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    );
  `);
  const applied: string[] = [];
  for (const migration of CONTROL_PLANE_MIGRATIONS) {
    const rows = await engine.query<{ id: string }>('SELECT id FROM schema_migrations WHERE id = $1', [
      migration.id,
    ]);
    if (rows.length) continue;
    await engine.exec(migration.sql);
    await engine.query('INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)', [
      migration.id,
      Date.now(),
    ]);
    applied.push(migration.id);
  }
  return applied;
}
