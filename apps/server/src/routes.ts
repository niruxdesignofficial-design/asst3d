import type { FastifyInstance, FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  ACCEPTED_IMAGE_TYPES,
  AI_MODELS,
  MAX_COMMENT_LENGTH,
  MAX_IMAGE_BYTES,
  MAX_PROMPT_LENGTH,
  POLYCOUNT_MAX,
  POLYCOUNT_MIN,
  STYLE_PRESETS,
  type CommentDto,
  type GenerateRequest,
  type MeDto,
} from "@asst3d/shared";
import { config } from "./config.js";
import type { Repo } from "./db/repo.js";
import type { MeshyClient } from "./meshy/types.js";
import type { UsageControl } from "./limits.js";
import { resolveSampleUrl } from "./meshy/mock.js";
import { getStorage, isStoredRef } from "./storage.js";
import { createSession, issueNonce, verifySession, verifyWalletSignature } from "./auth.js";
import { findBlockedTerm } from "./moderation.js";

interface Ctx {
  repo: Repo;
  meshy: MeshyClient;
  usage: UsageControl;
  /** cliente del modo Fast; undefined = todo va al proveedor default */
  fast?: MeshyClient;
  /** nombre del proveedor fast configurado (para la UI), o undefined */
  fastProvider?: string;
}

function deviceIdOf(req: FastifyRequest): string | null {
  const id = req.headers["x-device-id"];
  if (typeof id !== "string") return null;
  // ids de dispositivo: uuid generado por el cliente; validar formato defensivamente
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return null;
  return id;
}

/**
 * Usuario efectivo del request: la cuenta wallet si hay sesión válida,
 * si no la identidad guest del device. El rate limit sigue usando device+IP.
 */
function effectiveUserIdOf(req: FastifyRequest): string | null {
  const session = req.headers["x-session"];
  if (typeof session === "string") {
    const userId = verifySession(session);
    if (userId) return userId;
  }
  return deviceIdOf(req);
}

export function registerRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { repo, usage } = ctx;

  app.get("/api/health", async () => ({ ok: true, mock: config.meshyMock }));

  // ---- usuario actual (server-authoritative: acá se entera cuánto le queda) ----
  app.get("/api/me", async (req, reply) => {
    const deviceId = effectiveUserIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    const user = await repo.upsertUser(deviceId, req.ip);
    const me: MeDto = {
      deviceId,
      userId: user.id,
      username: user.display_name,
      freeLimit: usage.freeAllowance(user),
      freeUsed: user.generations_used,
      freeRemaining: usage.freeRemaining(user),
      capacityOk: await usage.capacityOk(),
      paymentsEnabled: config.paymentsEnabled,
      hasTokenAccess: user.token_access === 1,
      walletAddress: user.wallet_address,
      fastProvider: ctx.fastProvider ?? null,
    };
    return me;
  });

  // ---- login con wallet (nonce + firma ed25519 -> sesión HMAC) ----
  app.post("/api/auth/nonce", async (req, reply) => {
    const deviceId = deviceIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    return issueNonce(deviceId);
  });

  app.post("/api/auth/verify", async (req, reply) => {
    const deviceId = deviceIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    const { address, signature } = req.body as { address?: string; signature?: string };
    if (
      typeof address !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ||
      typeof signature !== "string"
    )
      return reply.code(400).send({ error: "invalid_input" });
    if (!usage.codeAttemptOk(deviceId, req.ip))
      return reply.code(429).send({ error: "rate_limited" });
    if (!verifyWalletSignature(deviceId, address, signature))
      return reply.code(401).send({ error: "invalid_signature" });

    // La cuenta wallet usa el address como user id; el device guest se migra.
    const wallet = await repo.upsertUser(address, req.ip);
    await repo.setWallet(address, address);
    await repo.mergeDeviceIntoWallet(deviceId, address);
    const session = createSession(address);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      username: wallet.display_name,
    };
  });

  // ---- reservar username único (requiere sesión de wallet) ----
  app.post("/api/users/username", async (req, reply) => {
    const session = req.headers["x-session"];
    const userId = typeof session === "string" ? verifySession(session) : null;
    if (!userId) return reply.code(401).send({ error: "auth_required" });
    const { name } = req.body as { name?: string };
    if (typeof name !== "string" || !/^[a-zA-Z0-9_]{3,20}$/.test(name.trim()))
      return reply.code(400).send({
        error: "invalid_input",
        message: "3-20 chars: letters, numbers, underscore",
      });
    if (!(await repo.claimUsername(userId, name.trim())))
      return reply.code(409).send({ error: "name_taken" });
    return { ok: true, username: name.trim() };
  });

  // ---- perfil público de autor ----
  app.get("/api/users/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const user = await repo.getUserByName(name);
    if (!user?.display_name) return reply.code(404).send({ error: "not_found" });
    const rows = (await repo.listByUser(user.id, 100)).filter(
      (r) => r.is_public === 1 && r.status === "done"
    );
    const models = await repo.toDtos(rows);
    return {
      name: user.display_name,
      joinedAt: Number(user.created_at),
      modelCount: models.length,
      totalLikes: models.reduce((a, m) => a + m.likes, 0),
      models,
    };
  });

  // ---- canje de código promo (ej. FREE3 => +3 generaciones gratis) ----
  app.post("/api/redeem-code", async (req, reply) => {
    const deviceId = effectiveUserIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    const { code } = req.body as { code?: string };
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{2,32}$/.test(code.trim()))
      return reply.code(400).send({ error: "invalid_input" });
    if (!usage.codeAttemptOk(deviceId, req.ip))
      return reply.code(429).send({ error: "rate_limited" });

    const normalized = code.trim().toUpperCase();
    const bonus = config.promoCodes.get(normalized);
    if (!bonus) return reply.code(404).send({ error: "invalid_code" });

    const user = await repo.upsertUser(deviceId, req.ip);
    if (!(await repo.redeemCode(user.id, normalized, bonus)))
      return reply.code(409).send({ error: "already_redeemed" });

    const updated = (await repo.getUser(user.id))!;
    return {
      ok: true,
      bonus,
      freeRemaining: usage.freeRemaining(updated),
      freeLimit: usage.freeAllowance(updated),
    };
  });

  // ---- crear generación ----
  app.post("/api/generate", async (req, reply) => {
    const deviceId = effectiveUserIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    const body = req.body as GenerateRequest;

    // Validación de input
    if (body.kind !== "text" && body.kind !== "image")
      return reply.code(400).send({ error: "invalid_input", message: "invalid kind" });
    const style = STYLE_PRESETS.find((s) => s.id === body.styleId) ?? STYLE_PRESETS[0];

    // Optional overrides on top of the preset (validated server-side).
    const modelType =
      body.modelType === "standard" || body.modelType === "lowpoly"
        ? body.modelType
        : style.modelType;
    let targetPolycount = style.targetPolycount;
    if (typeof body.targetPolycount === "number") {
      if (
        !Number.isFinite(body.targetPolycount) ||
        body.targetPolycount < POLYCOUNT_MIN ||
        body.targetPolycount > POLYCOUNT_MAX
      )
        return reply.code(400).send({ error: "invalid_input", message: "invalid polycount" });
      targetPolycount = Math.round(body.targetPolycount);
    }
    const aiModel =
      AI_MODELS.find((m) => m.id === body.aiModelId)?.meshy ?? AI_MODELS[0].meshy;

    let prompt: string | null = null;
    if (body.kind === "text") {
      prompt = (body.prompt ?? "").trim();
      if (!prompt || prompt.length > MAX_PROMPT_LENGTH - style.promptSuffix.length - 2)
        return reply.code(400).send({
          error: "invalid_input",
          message: `El prompt debe tener entre 1 y ${MAX_PROMPT_LENGTH - style.promptSuffix.length - 2} caracteres`,
        });
      if (findBlockedTerm(prompt))
        return reply.code(400).send({
          error: "blocked_prompt",
          message: "That prompt isn't allowed on a public gallery.",
        });
    } else {
      const uri = body.imageDataUri ?? "";
      const m = uri.match(/^data:([a-z/+.-]+);base64,/i);
      if (!m || !ACCEPTED_IMAGE_TYPES.includes(m[1].toLowerCase()))
        return reply.code(400).send({ error: "invalid_input", message: "Imagen inválida (png/jpg/webp)" });
      const approxBytes = (uri.length - m[0].length) * 0.75;
      if (approxBytes > MAX_IMAGE_BYTES)
        return reply.code(400).send({ error: "invalid_input", message: "Imagen supera 20MB" });
      prompt = (body.prompt ?? "").trim().slice(0, MAX_PROMPT_LENGTH) || null;
    }

    // Control de uso: la decisión es 100% del server.
    const user = await repo.upsertUser(deviceId, req.ip);
    const deny = await usage.checkGenerate(user, req.ip);
    if (deny === "rate_limited") return reply.code(429).send({ error: deny });
    if (deny === "free_limit_reached") return reply.code(402).send({ error: deny });
    if (deny === "capacity_reached") return reply.code(503).send({ error: deny });

    // Modo Fast (~30-60s via TRELLIS) si está disponible; si no, el default.
    const useFast = body.speed === "fast" && !!ctx.fast;
    const client = useFast ? ctx.fast! : ctx.meshy;

    const row = await repo.createGeneration({
      userId: user.id,
      kind: body.kind,
      prompt,
      styleId: style.id,
      modelType,
      isPublic: body.isPublic !== false,
      provider: useFast ? "fast" : undefined,
    });

    try {
      let taskId: string;
      if (body.kind === "text") {
        taskId = await client.createTextPreview({
          prompt: `${prompt}, ${style.promptSuffix}`,
          modelType,
          targetPolycount,
          aiModel,
        });
      } else {
        taskId = await client.createImageTo3D({
          imageDataUri: body.imageDataUri!,
          modelType,
          targetPolycount,
          aiModel,
        });
      }
      await repo.updateGeneration(row.id, { meshy_task_id: taskId, status: "processing" });
    } catch (err) {
      await repo.updateGeneration(row.id, {
        status: "failed",
        error: String((err as Error).message ?? err).slice(0, 500),
      });
      return reply.code(502).send({ error: "upstream_failed", id: row.id });
    }

    // El uso se cuenta recién cuando el proveedor aceptó el job.
    await usage.consume(user, req.ip, row.id);
    return reply.code(201).send(await repo.toDto((await repo.getGeneration(row.id))!, deviceId));
  });

  // ---- estado / detalle ----
  app.get("/api/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await repo.getGeneration(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return repo.toDto(row, effectiveUserIdOf(req));
  });

  // ---- historial del usuario ----
  app.get("/api/generations", async (req, reply) => {
    const deviceId = effectiveUserIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    return repo.toDtos(await repo.listByUser(deviceId), deviceId);
  });

  // ---- galería pública (Discover): búsqueda + orden + paginación ----
  app.get("/api/discover", async (req) => {
    const { q, sort, page } = req.query as { q?: string; sort?: string; page?: string };
    const rows = await repo.searchPublic({
      q,
      sort: sort === "top" || sort === "recent" ? sort : "trending",
      page: Number.isFinite(Number(page)) ? Number(page) : 0,
    });
    return repo.toDtos(rows, effectiveUserIdOf(req));
  });

  // ---- reporte de la comunidad (auto-despublica al llegar al umbral) ----
  app.post("/api/generations/:id/report", async (req, reply) => {
    const deviceId = deviceIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    if (!usage.codeAttemptOk(`report:${deviceId}`, req.ip))
      return reply.code(429).send({ error: "rate_limited" });
    const { id } = req.params as { id: string };
    if (!(await repo.getGeneration(id))) return reply.code(404).send({ error: "not_found" });
    const reports = await repo.reportGeneration(id);
    return { ok: true, reports };
  });

  // ---- admin (deshabilitado sin ADMIN_TOKEN) ----
  const isAdmin = (req: FastifyRequest) =>
    !!config.adminToken && req.headers["x-admin-token"] === config.adminToken;

  app.get("/api/admin/overview", async (req, reply) => {
    if (!isAdmin(req)) return reply.code(401).send({ error: "auth_required" });
    const balance = await ctx.meshy.getBalance().catch(() => null);
    const monthly = await repo.getMonthlyCount();
    const users = await repo.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users`);
    const recent = await repo.db.all<import("./db/repo.js").GenerationRow>(
      `SELECT * FROM generations ORDER BY created_at DESC LIMIT 25`
    );
    return {
      providerBalance: balance,
      monthlyGenerations: monthly,
      totalUsers: users?.n ?? 0,
      recent: recent.map((r) => ({
        id: r.id,
        prompt: r.prompt,
        status: r.status,
        isPublic: r.is_public === 1,
        reports: r.reports,
        userId: r.user_id,
        createdAt: Number(r.created_at),
      })),
    };
  });

  app.post("/api/admin/generations/:id/unpublish", async (req, reply) => {
    if (!isAdmin(req)) return reply.code(401).send({ error: "auth_required" });
    const { id } = req.params as { id: string };
    await repo.db.run(`UPDATE generations SET is_public = 0 WHERE id = ?`, [id]);
    return { ok: true };
  });

  app.post("/api/admin/users/:id/ban", async (req, reply) => {
    if (!isAdmin(req)) return reply.code(401).send({ error: "auth_required" });
    const { id } = req.params as { id: string };
    const { banned } = req.body as { banned?: boolean };
    await repo.setBanned(id, banned !== false);
    return { ok: true };
  });

  // ---- comments ----
  app.get("/api/generations/:id/comments", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await repo.getGeneration(id))) return reply.code(404).send({ error: "not_found" });
    const rows = await repo.listComments(id);
    const dto: CommentDto[] = await Promise.all(
      rows.map(async (c) => ({
        id: c.id,
        authorName: (await repo.getUser(c.user_id))?.display_name ?? "guest",
        body: c.body,
        createdAt: Number(c.created_at),
      }))
    );
    return dto;
  });

  app.post("/api/generations/:id/comments", async (req, reply) => {
    const deviceId = effectiveUserIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    const { id } = req.params as { id: string };
    if (!(await repo.getGeneration(id))) return reply.code(404).send({ error: "not_found" });
    const { body } = req.body as { body?: string };
    const text = typeof body === "string" ? body.trim() : "";
    if (!text || text.length > MAX_COMMENT_LENGTH)
      return reply.code(400).send({ error: "invalid_input" });
    const user = await repo.upsertUser(deviceId, req.ip);
    const comment = await repo.addComment(id, user.id, text);
    const dto: CommentDto = {
      id: comment.id,
      authorName: user.display_name ?? "guest",
      body: text,
      createdAt: Number(comment.created_at),
    };
    return reply.code(201).send(dto);
  });

  // ---- gestión de modelos propios (ownership validado server-side) ----
  app.patch("/api/generations/:id", async (req, reply) => {
    const userId = effectiveUserIdOf(req);
    if (!userId) return reply.code(400).send({ error: "invalid_input" });
    const { id } = req.params as { id: string };
    const row = await repo.getGeneration(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.user_id !== userId) return reply.code(403).send({ error: "not_owner" });

    const body = req.body as { title?: string; isPublic?: boolean };
    const patch: { prompt?: string; is_public?: number } = {};
    if (typeof body.title === "string") {
      const t = body.title.trim();
      if (!t || t.length > 120) return reply.code(400).send({ error: "invalid_input" });
      patch.prompt = t;
    }
    if (typeof body.isPublic === "boolean") patch.is_public = body.isPublic ? 1 : 0;
    if (Object.keys(patch).length === 0)
      return reply.code(400).send({ error: "invalid_input" });
    await repo.db.run(
      `UPDATE generations SET ${Object.keys(patch)
        .map((k) => `${k} = ?`)
        .join(", ")}, updated_at = ? WHERE id = ?`,
      [...Object.values(patch), Date.now(), id]
    );
    return repo.toDto((await repo.getGeneration(id))!, userId);
  });

  app.delete("/api/generations/:id", async (req, reply) => {
    const userId = effectiveUserIdOf(req);
    if (!userId) return reply.code(400).send({ error: "invalid_input" });
    const { id } = req.params as { id: string };
    const row = await repo.getGeneration(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.user_id !== userId) return reply.code(403).send({ error: "not_owner" });

    // borrar blobs persistidos (glb + thumbnail) y después la fila
    const urls = row.model_urls ? (JSON.parse(row.model_urls) as Record<string, string>) : {};
    for (const ref of [urls.glb, row.thumbnail_url]) {
      if (ref && isStoredRef(ref)) await getStorage().delete(ref);
    }
    await repo.deleteGeneration(id);
    return { ok: true };
  });

  // ---- like ----
  app.post("/api/generations/:id/like", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await repo.getGeneration(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    await repo.updateGeneration(id, { likes: row.likes + 1 });
    return { likes: row.likes + 1 };
  });

  // ---- thumbnail subido por el cliente (para mock/seeds sin render server-side) ----
  app.post("/api/generations/:id/client-thumbnail", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await repo.getGeneration(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    const { dataUri } = req.body as { dataUri?: string };
    if (
      typeof dataUri !== "string" ||
      !dataUri.startsWith("data:image/") ||
      dataUri.length > 300_000
    )
      return reply.code(400).send({ error: "invalid_input" });
    if (!row.thumbnail_data) await repo.updateGeneration(id, { thumbnail_data: dataUri });
    return { ok: true };
  });

  // ---- servir el GLB para el visor (proxy; las URLs de los proveedores expiran) ----
  app.get("/api/generations/:id/model.glb", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await repo.getGeneration(id);
    if (!row?.model_urls) return reply.code(404).send({ error: "not_found" });
    const urls = JSON.parse(row.model_urls) as Record<string, string>;
    if (!urls.glb) return reply.code(404).send({ error: "not_found" });
    return streamModel(reply, urls.glb, "model/gltf-binary");
  });

  // ---- descarga por formato ----
  app.get("/api/generations/:id/download", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { format } = req.query as { format?: string };
    const fmt = (format ?? "glb").toLowerCase();
    const row = await repo.getGeneration(id);
    if (!row?.model_urls) return reply.code(404).send({ error: "not_found" });
    const urls = JSON.parse(row.model_urls) as Record<string, string>;
    const url = urls[fmt];
    if (!url) return reply.code(404).send({ error: "not_found" });
    reply.header(
      "Content-Disposition",
      `attachment; filename="formora-${id.slice(0, 8)}.${fmt}"`
    );
    return streamModel(reply, url, "application/octet-stream");
  });

  // ---- thumbnail (persistido en storage, o proxy upstream para filas viejas) ----
  app.get("/api/generations/:id/thumbnail", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await repo.getGeneration(id);
    if (!row?.thumbnail_url) return reply.code(404).send({ error: "not_found" });
    if (isStoredRef(row.thumbnail_url)) {
      const stream = await getStorage().stream(row.thumbnail_url);
      if (!stream) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.type("image/png").send(stream);
    }
    const res = await fetch(row.thumbnail_url);
    if (!res.ok || !res.body) return reply.code(502).send({ error: "upstream_failed" });
    reply.header("Cache-Control", "public, max-age=86400");
    return reply
      .type(res.headers.get("content-type") ?? "image/png")
      .send(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream));
  });

  async function streamModel(
    reply: import("fastify").FastifyReply,
    url: string,
    contentType: string
  ) {
    const sample = resolveSampleUrl(url);
    if (sample) {
      if (!fs.existsSync(sample)) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.type(contentType).send(fs.createReadStream(sample));
    }
    if (isStoredRef(url)) {
      const stream = await getStorage().stream(url);
      if (!stream) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "public, max-age=86400");
      const size = await getStorage().size(url);
      if (size) reply.header("Content-Length", size);
      return reply.type(contentType).send(stream);
    }
    const res = await fetch(url);
    if (!res.ok || !res.body) return reply.code(502).send({ error: "upstream_failed" });
    return reply
      .type(contentType)
      .send(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream));
  }

  // ---- GLBs de muestra (los usa el mock) ----
  app.get("/api/samples/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    const safe = path.basename(file);
    const full = path.join(config.samplesDir, safe);
    if (!safe.endsWith(".glb") || !fs.existsSync(full))
      return reply.code(404).send({ error: "not_found" });
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("model/gltf-binary").send(fs.createReadStream(full));
  });

  // ---- Web3: vincular wallet + verificación de acceso (pago APAGADO por flag) ----
  app.post("/api/wallet/link", async (req, reply) => {
    const deviceId = deviceIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    const { address } = req.body as { address?: string };
    if (typeof address !== "string" || !/^[a-zA-Z0-9]{20,64}$/.test(address))
      return reply.code(400).send({ error: "invalid_input" });
    const user = await repo.upsertUser(deviceId, req.ip);
    await repo.setWallet(user.id, address);
    return { ok: true, address };
  });

  app.post("/api/wallet/verify-access", async (req, reply) => {
    // Lógica lista, pago apagado: NUNCA toca la chain con el flag off.
    if (!config.paymentsEnabled) return reply.code(403).send({ error: "payments_off" });
    // Cuando el dueño configure TOKEN_GATE_ADDRESS y prenda el flag,
    // acá va la verificación on-chain de holdeo/pago del token.
    return reply.code(501).send({ error: "not_implemented" });
  });
}
