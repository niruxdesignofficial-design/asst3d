import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  DownloadFormat,
  GenerationDto,
  GenerationKind,
  GenerationStatus,
} from "@asst3d/shared";

export interface UserRow {
  id: string;
  created_at: number;
  last_ip: string | null;
  generations_used: number;
  wallet_address: string | null;
  token_access: number;
  display_name: string | null;
}

export interface GenerationRow {
  id: string;
  user_id: string;
  kind: GenerationKind;
  prompt: string | null;
  style_id: string;
  model_type: string;
  status: GenerationStatus;
  stage: string | null;
  progress: number;
  meshy_task_id: string | null;
  model_urls: string | null;
  thumbnail_url: string | null;
  thumbnail_data: string | null;
  error: string | null;
  is_public: number;
  likes: number;
  created_at: number;
  updated_at: number;
}

export class Repo {
  constructor(private db: Database.Database) {}

  // ---- users ----
  upsertUser(deviceId: string, ip: string | null): UserRow {
    this.db
      .prepare(
        `INSERT INTO users (id, created_at, last_ip) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_ip = excluded.last_ip`
      )
      .run(deviceId, Date.now(), ip);
    return this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(deviceId) as UserRow;
  }

  getUser(deviceId: string): UserRow | undefined {
    return this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(deviceId) as
      | UserRow
      | undefined;
  }

  incrementUsage(userId: string, ip: string | null, generationId: string): void {
    this.db
      .prepare(`UPDATE users SET generations_used = generations_used + 1 WHERE id = ?`)
      .run(userId);
    this.db
      .prepare(`INSERT INTO usage_log (user_id, ip, generation_id, at) VALUES (?, ?, ?, ?)`)
      .run(userId, ip, generationId, Date.now());
  }

  setWallet(userId: string, address: string | null): void {
    this.db.prepare(`UPDATE users SET wallet_address = ? WHERE id = ?`).run(address, userId);
  }

  setDisplayName(userId: string, name: string): void {
    this.db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(name, userId);
  }

  // ---- comments ----
  listComments(generationId: string, limit = 100): Array<{
    id: number;
    user_id: string;
    body: string;
    created_at: number;
  }> {
    return this.db
      .prepare(
        `SELECT id, user_id, body, created_at FROM comments
         WHERE generation_id = ? ORDER BY created_at ASC LIMIT ?`
      )
      .all(generationId, limit) as Array<{
      id: number;
      user_id: string;
      body: string;
      created_at: number;
    }>;
  }

  addComment(generationId: string, userId: string, body: string): number {
    const r = this.db
      .prepare(
        `INSERT INTO comments (generation_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(generationId, userId, body, Date.now());
    return Number(r.lastInsertRowid);
  }

  // ---- tope global mensual ----
  currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  getMonthlyCount(month = this.currentMonth()): number {
    const row = this.db
      .prepare(`SELECT count FROM usage_monthly WHERE month = ?`)
      .get(month) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  incrementMonthly(month = this.currentMonth()): void {
    this.db
      .prepare(
        `INSERT INTO usage_monthly (month, count) VALUES (?, 1)
         ON CONFLICT(month) DO UPDATE SET count = count + 1`
      )
      .run(month);
  }

  // ---- generations ----
  createGeneration(input: {
    userId: string;
    kind: GenerationKind;
    prompt: string | null;
    styleId: string;
    modelType: string;
    isPublic: boolean;
  }): GenerationRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO generations
           (id, user_id, kind, prompt, style_id, model_type, status, stage, progress, is_public, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?)`
      )
      .run(
        id,
        input.userId,
        input.kind,
        input.prompt,
        input.styleId,
        input.modelType,
        input.kind === "text" ? "preview" : null,
        input.isPublic ? 1 : 0,
        now,
        now
      );
    return this.getGeneration(id)!;
  }

  getGeneration(id: string): GenerationRow | undefined {
    return this.db.prepare(`SELECT * FROM generations WHERE id = ?`).get(id) as
      | GenerationRow
      | undefined;
  }

  listByUser(userId: string, limit = 50): GenerationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(userId, limit) as GenerationRow[];
  }

  listPublic(limit = 60): GenerationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM generations
         WHERE is_public = 1 AND status = 'done'
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as GenerationRow[];
  }

  listActive(): GenerationRow[] {
    return this.db
      .prepare(`SELECT * FROM generations WHERE status IN ('pending','processing')`)
      .all() as GenerationRow[];
  }

  updateGeneration(
    id: string,
    patch: Partial<{
      status: GenerationStatus;
      stage: string | null;
      progress: number;
      meshy_task_id: string | null;
      model_urls: string | null;
      thumbnail_url: string | null;
      thumbnail_data: string | null;
      error: string | null;
      likes: number;
    }>
  ): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => patch[k] ?? null);
    this.db
      .prepare(`UPDATE generations SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...values, Date.now(), id);
  }

  // ---- mapping a DTO público ----
  toDto(row: GenerationRow, authorName = "guest"): GenerationDto {
    const urls = row.model_urls ? (JSON.parse(row.model_urls) as Record<string, string>) : {};
    const formats = Object.keys(urls).filter((f) =>
      ["glb", "fbx", "obj", "usdz"].includes(f)
    ) as DownloadFormat[];
    const user = this.getUser(row.user_id);
    return {
      id: row.id,
      kind: row.kind,
      prompt: row.prompt,
      styleId: row.style_id,
      status: row.status,
      progress: row.progress,
      formats,
      thumbnailUrl: row.thumbnail_data
        ? row.thumbnail_data
        : row.thumbnail_url
          ? `/api/generations/${row.id}/thumbnail`
          : null,
      viewerUrl:
        row.status === "done" && urls.glb ? `/api/generations/${row.id}/model.glb` : null,
      error: row.error,
      isPublic: row.is_public === 1,
      authorName: user?.display_name ?? authorName,
      likes: row.likes,
      createdAt: row.created_at,
    };
  }
}
