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
import { resolveLocalUrl } from "./persist.js";

interface Ctx {
  repo: Repo;
  meshy: MeshyClient;
  usage: UsageControl;
}

function deviceIdOf(req: FastifyRequest): string | null {
  const id = req.headers["x-device-id"];
  if (typeof id !== "string") return null;
  // ids de dispositivo: uuid generado por el cliente; validar formato defensivamente
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return null;
  return id;
}

export function registerRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { repo, usage } = ctx;

  app.get("/api/health", async () => ({ ok: true, mock: config.meshyMock }));

  // ---- usuario actual (server-authoritative: acá se entera cuánto le queda) ----
  app.get("/api/me", async (req, reply) => {
    const deviceId = deviceIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    const user = repo.upsertUser(deviceId, req.ip);
    const me: MeDto = {
      deviceId,
      freeLimit: config.freeGenerationsPerUser,
      freeUsed: user.generations_used,
      freeRemaining: usage.freeRemaining(user),
      capacityOk: await usage.capacityOk(),
      paymentsEnabled: config.paymentsEnabled,
      hasTokenAccess: user.token_access === 1,
      walletAddress: user.wallet_address,
    };
    return me;
  });

  // ---- crear generación ----
  app.post("/api/generate", async (req, reply) => {
    const deviceId = deviceIdOf(req);
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
    const user = repo.upsertUser(deviceId, req.ip);
    const deny = await usage.checkGenerate(user, req.ip);
    if (deny === "rate_limited") return reply.code(429).send({ error: deny });
    if (deny === "free_limit_reached") return reply.code(402).send({ error: deny });
    if (deny === "capacity_reached") return reply.code(503).send({ error: deny });

    const row = repo.createGeneration({
      userId: user.id,
      kind: body.kind,
      prompt,
      styleId: style.id,
      modelType,
      isPublic: body.isPublic !== false,
    });

    try {
      let taskId: string;
      if (body.kind === "text") {
        taskId = await ctx.meshy.createTextPreview({
          prompt: `${prompt}, ${style.promptSuffix}`,
          modelType,
          targetPolycount,
          aiModel,
        });
      } else {
        taskId = await ctx.meshy.createImageTo3D({
          imageDataUri: body.imageDataUri!,
          modelType,
          targetPolycount,
        });
      }
      repo.updateGeneration(row.id, { meshy_task_id: taskId, status: "processing" });
    } catch (err) {
      repo.updateGeneration(row.id, {
        status: "failed",
        error: String((err as Error).message ?? err).slice(0, 500),
      });
      return reply.code(502).send({ error: "upstream_failed", id: row.id });
    }

    // El uso se cuenta recién cuando Meshy aceptó el job.
    usage.consume(user, req.ip, row.id);
    return reply.code(201).send(repo.toDto(repo.getGeneration(row.id)!));
  });

  // ---- estado / detalle ----
  app.get("/api/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = repo.getGeneration(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return repo.toDto(row);
  });

  // ---- historial del usuario ----
  app.get("/api/generations", async (req, reply) => {
    const deviceId = deviceIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    return repo.listByUser(deviceId).map((r) => repo.toDto(r));
  });

  // ---- galería pública (Discover) ----
  app.get("/api/discover", async () => {
    return repo.listPublic().map((r) => repo.toDto(r));
  });

  // ---- comments ----
  app.get("/api/generations/:id/comments", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!repo.getGeneration(id)) return reply.code(404).send({ error: "not_found" });
    const rows = repo.listComments(id);
    const dto: CommentDto[] = rows.map((c) => ({
      id: c.id,
      authorName: repo.getUser(c.user_id)?.display_name ?? "guest",
      body: c.body,
      createdAt: c.created_at,
    }));
    return dto;
  });

  app.post("/api/generations/:id/comments", async (req, reply) => {
    const deviceId = deviceIdOf(req);
    if (!deviceId) return reply.code(400).send({ error: "invalid_input" });
    const { id } = req.params as { id: string };
    if (!repo.getGeneration(id)) return reply.code(404).send({ error: "not_found" });
    const { body } = req.body as { body?: string };
    const text = typeof body === "string" ? body.trim() : "";
    if (!text || text.length > MAX_COMMENT_LENGTH)
      return reply.code(400).send({ error: "invalid_input" });
    const user = repo.upsertUser(deviceId, req.ip);
    const commentId = repo.addComment(id, user.id, text);
    const dto: CommentDto = {
      id: commentId,
      authorName: user.display_name ?? "guest",
      body: text,
      createdAt: Date.now(),
    };
    return reply.code(201).send(dto);
  });

  // ---- like ----
  app.post("/api/generations/:id/like", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = repo.getGeneration(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    repo.updateGeneration(id, { likes: row.likes + 1 });
    return { likes: row.likes + 1 };
  });

  // ---- thumbnail subido por el cliente (para mock/seeds sin render server-side) ----
  app.post("/api/generations/:id/client-thumbnail", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = repo.getGeneration(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    const { dataUri } = req.body as { dataUri?: string };
    if (
      typeof dataUri !== "string" ||
      !dataUri.startsWith("data:image/") ||
      dataUri.length > 300_000
    )
      return reply.code(400).send({ error: "invalid_input" });
    if (!row.thumbnail_data) repo.updateGeneration(id, { thumbnail_data: dataUri });
    return { ok: true };
  });

  // ---- servir el GLB para el visor (proxy; las URLs de Meshy expiran) ----
  app.get("/api/generations/:id/model.glb", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = repo.getGeneration(id);
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
    const row = repo.getGeneration(id);
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

  // ---- thumbnail remoto (proxy de Meshy) ----
  app.get("/api/generations/:id/thumbnail", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = repo.getGeneration(id);
    if (!row?.thumbnail_url) return reply.code(404).send({ error: "not_found" });
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
    const local = resolveSampleUrl(url) ?? resolveLocalUrl(url);
    if (local) {
      if (!fs.existsSync(local)) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.type(contentType).send(fs.createReadStream(local));
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
    const user = repo.upsertUser(deviceId, req.ip);
    repo.setWallet(user.id, address);
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
