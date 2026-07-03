import Database from "better-sqlite3";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

/**
 * Driver de DB dual: SQLite (dev / sin config) o Postgres (DATABASE_URL, ej. Neon).
 * Interfaz async única para que el resto del server no sepa cuál corre.
 * SQL portable: placeholders "?" (se traducen a $n en Postgres).
 */
export interface DbDriver {
  readonly dialect: "sqlite" | "postgres";
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** fn corre dentro de BEGIN/COMMIT; cualquier throw hace ROLLBACK. */
  transaction<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T>;
}

// ---------- SQLite ----------

class SqliteDriver implements DbDriver {
  readonly dialect = "sqlite" as const;
  constructor(private db: Database.Database) {}

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async transaction<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = await fn(this);
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

// ---------- Postgres ----------

function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class PgDriver implements DbDriver {
  readonly dialect = "postgres" as const;
  constructor(private q: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) {}

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.q.query(toPgPlaceholders(sql), params);
  }
  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const r = await this.q.query(toPgPlaceholders(sql), params);
    return r.rows[0] as T | undefined;
  }
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.q.query(toPgPlaceholders(sql), params);
    return r.rows as T[];
  }
  async transaction<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    const pool = this.q as pg.Pool;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(new PgDriver(client));
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

// ---------- apertura + migraciones ----------

const SQLITE_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_ip TEXT,
    generations_used INTEGER NOT NULL DEFAULT 0,
    wallet_address TEXT,
    token_access INTEGER NOT NULL DEFAULT 0,
    display_name TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    prompt TEXT,
    style_id TEXT NOT NULL,
    model_type TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    meshy_task_id TEXT,
    model_urls TEXT,
    thumbnail_url TEXT,
    thumbnail_data TEXT,
    error TEXT,
    is_public INTEGER NOT NULL DEFAULT 1,
    likes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_generations_public ON generations(is_public, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_generations_active ON generations(status)`,
  `CREATE TABLE IF NOT EXISTS usage_monthly (
    month TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ip TEXT,
    generation_id TEXT,
    at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS redeemed_codes (
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (user_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comments_gen ON comments(generation_id, created_at)`,
  // Archivos persistidos (GLBs/thumbnails) cuando no hay object storage:
  // viven en la DB misma y así sobreviven a los discos efímeros del hosting.
  `CREATE TABLE IF NOT EXISTS blobs (
    key TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )`,
];

const SQLITE_COLUMN_MIGRATIONS: string[] = [
  `ALTER TABLE users ADD COLUMN bonus_generations INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE generations ADD COLUMN provider TEXT`,
  `ALTER TABLE generations ADD COLUMN reports INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0`,
];

// Postgres: DDL equivalente (BIGINT para timestamps en ms, BIGSERIAL para ids).
const PG_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    last_ip TEXT,
    generations_used INTEGER NOT NULL DEFAULT 0,
    bonus_generations INTEGER NOT NULL DEFAULT 0,
    wallet_address TEXT,
    token_access INTEGER NOT NULL DEFAULT 0,
    display_name TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    prompt TEXT,
    style_id TEXT NOT NULL,
    model_type TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    meshy_task_id TEXT,
    provider TEXT,
    model_urls TEXT,
    thumbnail_url TEXT,
    thumbnail_data TEXT,
    error TEXT,
    is_public INTEGER NOT NULL DEFAULT 1,
    likes INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_generations_public ON generations(is_public, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_generations_active ON generations(status)`,
  `CREATE TABLE IF NOT EXISTS usage_monthly (
    month TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS usage_log (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    ip TEXT,
    generation_id TEXT,
    at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS redeemed_codes (
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    at BIGINT NOT NULL,
    PRIMARY KEY (user_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    generation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comments_gen ON comments(generation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS blobs (
    key TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    data BYTEA NOT NULL,
    created_at BIGINT NOT NULL
  )`,
];

export interface OpenOptions {
  /** ruta del archivo sqlite o ":memory:" (solo si no hay databaseUrl) */
  sqlitePath?: string;
  /** connection string de Postgres (ej. Neon); si está, gana. */
  databaseUrl?: string;
  dataDir?: string;
}

export async function openDriver(opts: OpenOptions): Promise<DbDriver> {
  if (opts.databaseUrl) {
    // BIGINT (int8) llega como string por default: parsearlo a Number
    // (timestamps en ms entran cómodos en 2^53).
    pg.types.setTypeParser(20, (v) => Number(v));
    const pool = new pg.Pool({
      connectionString: opts.databaseUrl,
      max: 5,
      // Neon requiere TLS; sslmode=require viene en la URL, esto es el fallback.
      ssl: opts.databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
    const driver = new PgDriver(pool);
    for (const sql of PG_MIGRATIONS) await driver.run(sql);
    // columnas agregadas después del primer deploy (PG soporta IF NOT EXISTS)
    for (const sql of [
      `ALTER TABLE generations ADD COLUMN IF NOT EXISTS reports INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS banned INTEGER NOT NULL DEFAULT 0`,
    ])
      await driver.run(sql);
    return driver;
  }

  const file = opts.sqlitePath ?? path.join(opts.dataDir ?? ".", "asst3d.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  for (const sql of SQLITE_MIGRATIONS) db.exec(sql);
  for (const sql of SQLITE_COLUMN_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!String(err).includes("duplicate column")) throw err;
    }
  }
  return new SqliteDriver(db);
}
