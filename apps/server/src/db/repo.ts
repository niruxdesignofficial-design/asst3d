import { randomUUID } from "node:crypto";
import type {
  DownloadFormat,
  GenerationDto,
  GenerationKind,
  GenerationStatus,
} from "@asst3d/shared";
import type { DbDriver } from "./driver.js";

export interface UserRow {
  id: string;
  created_at: number;
  last_ip: string | null;
  generations_used: number;
  bonus_generations: number;
  wallet_address: string | null;
  token_access: number;
  banned: number;
  display_name: string | null;
}

export interface GenerationRow {
  id: string;
  user_id: string;
  reports: number;
  kind: GenerationKind;
  prompt: string | null;
  style_id: string;
  model_type: string;
  status: GenerationStatus;
  stage: string | null;
  progress: number;
  meshy_task_id: string | null;
  provider: string | null;
  model_urls: string | null;
  thumbnail_url: string | null;
  thumbnail_data: string | null;
  error: string | null;
  is_public: number;
  likes: number;
  created_at: number;
  updated_at: number;
}

export interface CommentRow {
  id: number;
  generation_id: string;
  user_id: string;
  body: string;
  created_at: number;
}

export class Repo {
  constructor(readonly db: DbDriver) {}

  // ---- users ----
  async upsertUser(deviceId: string, ip: string | null): Promise<UserRow> {
    await this.db.run(
      `INSERT INTO users (id, created_at, last_ip) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_ip = excluded.last_ip`,
      [deviceId, Date.now(), ip]
    );
    return (await this.getUser(deviceId))!;
  }

  getUser(deviceId: string): Promise<UserRow | undefined> {
    return this.db.get<UserRow>(`SELECT * FROM users WHERE id = ?`, [deviceId]);
  }

  /** Devuelve una generación al cupo del usuario (cuando el job falla). */
  async refundUsage(userId: string): Promise<void> {
    await this.db.run(
      `UPDATE users SET generations_used = CASE WHEN generations_used > 0 THEN generations_used - 1 ELSE 0 END WHERE id = ?`,
      [userId]
    );
  }

  async incrementUsage(userId: string, ip: string | null, generationId: string): Promise<void> {
    await this.db.run(`UPDATE users SET generations_used = generations_used + 1 WHERE id = ?`, [
      userId,
    ]);
    await this.db.run(
      `INSERT INTO usage_log (user_id, ip, generation_id, at) VALUES (?, ?, ?, ?)`,
      [userId, ip, generationId, Date.now()]
    );
  }

  async setWallet(userId: string, address: string | null): Promise<void> {
    await this.db.run(`UPDATE users SET wallet_address = ? WHERE id = ?`, [address, userId]);
  }

  async setDisplayName(userId: string, name: string): Promise<void> {
    await this.db.run(`UPDATE users SET display_name = ? WHERE id = ?`, [name, userId]);
  }

  getUserByName(name: string): Promise<UserRow | undefined> {
    return this.db.get<UserRow>(`SELECT * FROM users WHERE display_name = ?`, [name]);
  }

  /** Intenta reservar un username único. false si ya está tomado. */
  async claimUsername(userId: string, name: string): Promise<boolean> {
    const taken = await this.getUserByName(name);
    if (taken && taken.id !== userId) return false;
    await this.setDisplayName(userId, name);
    return true;
  }

  /**
   * Migra la identidad guest (device) a la cuenta wallet: el historial y los
   * contadores del device pasan a la cuenta. Idempotente si no hay nada que migrar.
   */
  async mergeDeviceIntoWallet(deviceId: string, walletUserId: string): Promise<void> {
    if (deviceId === walletUserId) return;
    const device = await this.getUser(deviceId);
    if (!device) return;
    await this.db.transaction(async (tx) => {
      await tx.run(`UPDATE generations SET user_id = ? WHERE user_id = ?`, [
        walletUserId,
        deviceId,
      ]);
      await tx.run(`UPDATE comments SET user_id = ? WHERE user_id = ?`, [
        walletUserId,
        deviceId,
      ]);
      await tx.run(
        `UPDATE users SET
           generations_used = generations_used + ?,
           bonus_generations = bonus_generations + ?
         WHERE id = ?`,
        [device.generations_used, device.bonus_generations, walletUserId]
      );
      // dejar el device en cero para no duplicar el cupo al volver a mergear
      await tx.run(
        `UPDATE users SET generations_used = 0, bonus_generations = 0 WHERE id = ?`,
        [deviceId]
      );
    });
  }

  async deleteGeneration(id: string): Promise<void> {
    await this.db.run(`DELETE FROM comments WHERE generation_id = ?`, [id]);
    await this.db.run(`DELETE FROM generations WHERE id = ?`, [id]);
  }

  /**
   * Canjea un código promo: atómico, una sola vez por usuario+código.
   * Devuelve false si ese usuario ya lo había canjeado.
   */
  async redeemCode(userId: string, code: string, bonus: number): Promise<boolean> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`INSERT INTO redeemed_codes (user_id, code, at) VALUES (?, ?, ?)`, [
          userId,
          code,
          Date.now(),
        ]);
        await tx.run(
          `UPDATE users SET bonus_generations = bonus_generations + ? WHERE id = ?`,
          [bonus, userId]
        );
      });
      return true;
    } catch (err) {
      const msg = String(err);
      if (msg.includes("UNIQUE") || msg.includes("PRIMARY") || msg.includes("duplicate key"))
        return false;
      throw err;
    }
  }

  // ---- tope global mensual ----
  currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  async getMonthlyCount(month = this.currentMonth()): Promise<number> {
    const row = await this.db.get<{ count: number }>(
      `SELECT count FROM usage_monthly WHERE month = ?`,
      [month]
    );
    return row?.count ?? 0;
  }

  async incrementMonthly(month = this.currentMonth()): Promise<void> {
    await this.db.run(
      `INSERT INTO usage_monthly (month, count) VALUES (?, 1)
       ON CONFLICT(month) DO UPDATE SET count = usage_monthly.count + 1`,
      [month]
    );
  }

  // ---- generations ----
  async createGeneration(input: {
    userId: string;
    kind: GenerationKind;
    prompt: string | null;
    styleId: string;
    modelType: string;
    isPublic: boolean;
    provider?: string;
  }): Promise<GenerationRow> {
    const id = randomUUID();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO generations
         (id, user_id, kind, prompt, style_id, model_type, status, stage, progress, is_public, provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?)`,
      [
        id,
        input.userId,
        input.kind,
        input.prompt,
        input.styleId,
        input.modelType,
        input.kind === "text" ? "preview" : null,
        input.isPublic ? 1 : 0,
        input.provider ?? null,
        now,
        now,
      ]
    );
    return (await this.getGeneration(id))!;
  }

  getGeneration(id: string): Promise<GenerationRow | undefined> {
    return this.db.get<GenerationRow>(`SELECT * FROM generations WHERE id = ?`, [id]);
  }

  listByUser(userId: string, limit = 50): Promise<GenerationRow[]> {
    return this.db.all<GenerationRow>(
      `SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
  }

  listPublic(limit = 60): Promise<GenerationRow[]> {
    return this.db.all<GenerationRow>(
      `SELECT * FROM generations
       WHERE is_public = 1 AND status = 'done'
       ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
  }

  /**
   * Descubrimiento server-side: búsqueda por prompt/autor, orden
   * trending (likes con decay temporal, aritmética portable) | recent | top,
   * y paginación. Todo sobre modelos públicos y terminados.
   */
  async searchPublic(opts: {
    q?: string;
    sort?: "trending" | "recent" | "top";
    page?: number;
    pageSize?: number;
  }): Promise<GenerationRow[]> {
    const pageSize = Math.min(Math.max(opts.pageSize ?? 24, 1), 60);
    const offset = Math.max(opts.page ?? 0, 0) * pageSize;
    const params: unknown[] = [];
    let where = `g.is_public = 1 AND g.status = 'done'`;
    if (opts.q?.trim()) {
      const like = `%${opts.q.trim().toLowerCase()}%`;
      where += ` AND (LOWER(g.prompt) LIKE ? OR LOWER(COALESCE(u.display_name,'')) LIKE ?)`;
      params.push(like, like);
    }
    // trending: likes / horas-desde-creación (suavizado) — funciona igual en ambos dialectos
    const order =
      opts.sort === "top"
        ? `g.likes DESC, g.created_at DESC`
        : opts.sort === "recent"
          ? `g.created_at DESC`
          : `(g.likes * 1000.0) / (((? - g.created_at) / 3600000.0) + 24.0) DESC, g.created_at DESC`;
    if (opts.sort !== "top" && opts.sort !== "recent") params.push(Date.now());
    params.push(pageSize, offset);
    return this.db.all<GenerationRow>(
      `SELECT g.* FROM generations g
       LEFT JOIN users u ON u.id = g.user_id
       WHERE ${where}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      params
    );
  }

  /** Reporte de la comunidad: al llegar al umbral se despublica hasta revisión. */
  async reportGeneration(id: string, autoUnpublishAt = 5): Promise<number> {
    await this.db.run(`UPDATE generations SET reports = reports + 1 WHERE id = ?`, [id]);
    const row = await this.getGeneration(id);
    const reports = row?.reports ?? 0;
    if (row && reports >= autoUnpublishAt && row.is_public === 1) {
      await this.db.run(`UPDATE generations SET is_public = 0 WHERE id = ?`, [id]);
    }
    return reports;
  }

  async setBanned(userId: string, banned: boolean): Promise<void> {
    await this.db.run(`UPDATE users SET banned = ? WHERE id = ?`, [banned ? 1 : 0, userId]);
  }

  listActive(): Promise<GenerationRow[]> {
    return this.db.all<GenerationRow>(
      `SELECT * FROM generations WHERE status IN ('pending','processing')`
    );
  }

  async updateGeneration(
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
  ): Promise<void> {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => patch[k] ?? null);
    await this.db.run(`UPDATE generations SET ${sets}, updated_at = ? WHERE id = ?`, [
      ...values,
      Date.now(),
      id,
    ]);
  }

  // ---- comments ----
  listComments(generationId: string, limit = 100): Promise<CommentRow[]> {
    return this.db.all<CommentRow>(
      `SELECT * FROM comments WHERE generation_id = ? ORDER BY created_at ASC LIMIT ?`,
      [generationId, limit]
    );
  }

  async addComment(generationId: string, userId: string, body: string): Promise<CommentRow> {
    const now = Date.now();
    await this.db.run(
      `INSERT INTO comments (generation_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`,
      [generationId, userId, body, now]
    );
    const row = await this.db.get<CommentRow>(
      `SELECT * FROM comments WHERE generation_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1`,
      [generationId, userId]
    );
    return row!;
  }

  // ---- mapping a DTO público ----
  async toDto(row: GenerationRow, requesterId?: string | null): Promise<GenerationDto> {
    const urls = row.model_urls ? (JSON.parse(row.model_urls) as Record<string, string>) : {};
    const formats = Object.keys(urls).filter((f) =>
      ["glb", "fbx", "obj", "usdz"].includes(f)
    ) as DownloadFormat[];
    const user = await this.getUser(row.user_id);
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
      // Disponible apenas hay GLB (aunque siga texturizando): preview progresivo.
      viewerUrl: urls.glb ? `/api/generations/${row.id}/model.glb` : null,
      error: row.error,
      isPublic: row.is_public === 1,
      authorName: user?.display_name ?? "guest",
      isMine: !!requesterId && row.user_id === requesterId,
      likes: row.likes,
      createdAt: Number(row.created_at),
    };
  }

  async toDtos(rows: GenerationRow[], requesterId?: string | null): Promise<GenerationDto[]> {
    return Promise.all(rows.map((r) => this.toDto(r, requesterId)));
  }
}
