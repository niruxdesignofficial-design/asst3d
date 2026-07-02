import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

// SQL portable (sin extensiones SQLite) para poder migrar a Postgres después:
// mismos nombres de tabla/columna, tipos simples, JSON como TEXT.
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,              -- device id (guest); después puede vincular wallet
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
    kind TEXT NOT NULL,               -- text | image
    prompt TEXT,
    style_id TEXT NOT NULL,
    model_type TEXT NOT NULL,
    status TEXT NOT NULL,             -- pending | processing | done | failed
    stage TEXT,                       -- preview | refine (solo text)
    progress INTEGER NOT NULL DEFAULT 0,
    meshy_task_id TEXT,
    model_urls TEXT,                  -- JSON {glb, fbx, obj, usdz}
    thumbnail_url TEXT,
    thumbnail_data TEXT,              -- data URI subido por el cliente (mock/seeds)
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
    month TEXT PRIMARY KEY,           -- 'YYYY-MM'
    count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ip TEXT,
    generation_id TEXT,
    at INTEGER NOT NULL
  )`,
];

export function openDb(dbPath?: string): Database.Database {
  const file = dbPath ?? path.join(config.dataDir, "asst3d.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  for (const sql of MIGRATIONS) db.exec(sql);
  return db;
}
