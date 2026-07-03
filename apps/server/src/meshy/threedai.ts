import { config } from "../config.js";
import type {
  ImageTo3DOptions,
  MeshyClient,
  MeshyTask,
  TextTo3DOptions,
} from "./types.js";

/**
 * Proveedor 3D AI Studio (api.3daistudio.com), modelo Tencent Hunyuan Pro.
 * Un solo job genera geometría + texturas (twoStage = false) y devuelve un GLB.
 * Docs: https://www.3daistudio.com/Platform/API/Documentation
 */

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.threedaiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.threedaiApiKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // Nunca loguear la key; el body de error del proveedor es seguro.
    const body = await res.text().catch(() => "");
    throw new Error(`3daistudio ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * La API tiene un rate limit bajísimo (~3 req/min): cacheamos el status de cada
 * task y solo pegamos al server cada STATUS_SPACING_MS, así el presupuesto de
 * requests queda libre para los submits (crear jobs / encadenar TRELLIS).
 */
const STATUS_SPACING_MS = 21_000;
const statusCache = new Map<string, { at: number; task: MeshyTask }>();

async function throttledStatus(
  taskId: string,
  fetcher: () => Promise<MeshyTask>
): Promise<MeshyTask> {
  const hit = statusCache.get(taskId);
  const now = Date.now();
  if (hit && now - hit.at < STATUS_SPACING_MS) return hit.task;
  try {
    const task = await fetcher();
    statusCache.set(taskId, { at: now, task });
    if (task.status === "SUCCEEDED" || task.status === "FAILED") {
      // estado terminal: liberar la entrada más tarde igual da lo mismo
      setTimeout(() => statusCache.delete(taskId), 60_000).unref?.();
    }
    return task;
  } catch (err) {
    // 429: devolver el último estado conocido (o "sigue en proceso") y no romper.
    if (String(err).includes("429") || String(err).includes("RATE_LIMITED")) {
      return hit?.task ?? { id: taskId, status: "IN_PROGRESS", progress: 0 };
    }
    throw err;
  }
}

interface SubmitResponse {
  task_id: string;
}

interface StatusResponse {
  status?: string;
  progress?: number;
  results?: Array<{
    asset?: string;
    asset_type?: string;
    metadata?: unknown;
  }>;
  error?: string;
  detail?: string;
}

/** El pro exige face_count 40k–1.5M; fuera de ese rango se usa generate_type LowPoly. */
function proBody(opts: {
  prompt?: string;
  modelType: "standard" | "lowpoly";
  targetPolycount?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: "3.1",
    // PBR = +20 créditos; configurable por env para estirar el presupuesto.
    enable_pbr: config.threedaiPbr,
    generate_type: opts.modelType === "lowpoly" ? "LowPoly" : "Normal",
  };
  if (opts.prompt) body.prompt = opts.prompt.slice(0, 1024);
  if (opts.targetPolycount && opts.targetPolycount >= 40_000 && opts.targetPolycount <= 1_500_000) {
    body.face_count = opts.targetPolycount;
  }
  return body;
}

export class ThreeDAIClient implements MeshyClient {
  readonly twoStage = false;

  /** Un solo paso: el "preview" ya es la generación completa. */
  async createTextPreview(opts: TextTo3DOptions): Promise<string> {
    const r = await apiFetch<SubmitResponse>("/v1/3d-models/tencent/generate/pro/", {
      method: "POST",
      body: JSON.stringify(
        proBody({
          prompt: opts.prompt,
          modelType: opts.modelType,
          targetPolycount: opts.targetPolycount,
        })
      ),
    });
    return r.task_id;
  }

  async createTextRefine(previewTaskId: string): Promise<string> {
    // No aplica en proveedores de un solo paso; el poller no debería llamarlo.
    return previewTaskId;
  }

  async createImageTo3D(opts: ImageTo3DOptions): Promise<string> {
    // Imagen→3D va por TRELLIS.2: ~32 créditos vs 60-80 de Hunyuan Pro,
    // salida GLB directa y mucho más rápido (30-50s).
    const body: Record<string, unknown> = {
      image: opts.imageDataUri, // acepta el data URI completo
      resolution: "1024",
      textures: true,
      texture_size: 1024,
      generate_thumbnail: true,
    };
    if (opts.targetPolycount) body.decimation_target = opts.targetPolycount;
    const r = await apiFetch<SubmitResponse>("/v1/3d-models/trellis2/generate/", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return r.task_id;
  }

  async getTask(taskId: string): Promise<MeshyTask> {
    return throttledStatus(taskId, async () => {
      const r = await apiFetch<StatusResponse>(`/v1/generation-request/${taskId}/status/`);
      const status = (r.status ?? "").toUpperCase();

      if (status === "FINISHED" || status === "COMPLETED" || status === "SUCCESS") {
        const model = r.results?.find(
          (x) => x.asset && (x.asset_type === "3D_MODEL" || x.asset_type == null)
        );
        if (!model?.asset) {
          return {
            id: taskId,
            status: "FAILED",
            progress: 100,
            task_error: { message: "finished without a 3D_MODEL asset" },
          };
        }
        const thumb = r.results?.find(
          (x) => x.asset && (x.asset_type === "THUMBNAIL" || x.asset_type === "IMAGE")
        );
        return {
          id: taskId,
          status: "SUCCEEDED",
          progress: 100,
          model_urls: { glb: model.asset },
          thumbnail_url: thumb?.asset,
        };
      }

      if (status === "FAILED" || status === "ERROR" || status === "CANCELED") {
        return {
          id: taskId,
          status: "FAILED",
          progress: 0,
          task_error: { message: r.error ?? r.detail ?? "generation failed" },
        };
      }

      // PENDING / RUNNING / IN_PROGRESS / desconocido: sigue en proceso.
      const progress =
        typeof r.progress === "number" ? Math.min(99, Math.round(r.progress)) : 0;
      return {
        id: taskId,
        status: progress > 0 ? "IN_PROGRESS" : "PENDING",
        progress,
      };
    });
  }

  async getBalance(): Promise<number> {
    // GET /account/user/wallet/ -> { "balance": "150.00" }
    const r = await apiFetch<{ balance: string | number }>("/account/user/wallet/");
    const n = Number(r.balance);
    return Number.isFinite(n) ? n : 0;
  }
}

/**
 * Pipeline RÁPIDO (~30-60s por modelo) sobre 3D AI Studio:
 *  - imagen→3D: TRELLIS.2 directo (~20-40s, 27 créditos).
 *  - texto→3D: Seedream genera una imagen (~20-40s, 10 créditos) y el poller
 *    encadena TRELLIS como "refine" (twoStage=true reutiliza el flujo de Meshy).
 */
export class ThreeDAIFastClient implements MeshyClient {
  readonly twoStage = true;

  private async createTrellis(image: { url?: string; dataUri?: string }): Promise<string> {
    const body: Record<string, unknown> = {
      resolution: "512", // el más rápido; suficiente para iterar
      textures: true,
      texture_size: 1024,
      generate_thumbnail: true,
    };
    if (image.url) body.image_url = image.url;
    if (image.dataUri) body.image = image.dataUri;
    const r = await apiFetch<SubmitResponse>("/v1/3d-models/trellis2/generate/", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return r.task_id;
  }

  /** Etapa 1 de texto: imagen rápida con Seedream. */
  async createTextPreview(opts: TextTo3DOptions): Promise<string> {
    const r = await apiFetch<SubmitResponse>("/v1/images/seedream/v5/lite/generate/", {
      method: "POST",
      body: JSON.stringify({
        prompt: `${opts.prompt}, single object centered on a plain dark background, soft studio lighting, 3/4 view`,
        image_size: "auto_2K",
        num_images: 1,
      }),
    });
    return r.task_id;
  }

  /** Etapa 2 de texto: la imagen generada entra a TRELLIS. */
  async createTextRefine(previewTaskId: string): Promise<string> {
    const r = await apiFetch<StatusResponse>(`/v1/generation-request/${previewTaskId}/status/`);
    const image = r.results?.find((x) => x.asset);
    if (!image?.asset) throw new Error("fast pipeline: image task finished without asset");
    return this.createTrellis({ url: image.asset });
  }

  async createImageTo3D(opts: ImageTo3DOptions): Promise<string> {
    return this.createTrellis({ dataUri: opts.imageDataUri });
  }

  async getTask(taskId: string): Promise<MeshyTask> {
    return throttledStatus(taskId, async () => {
      const r = await apiFetch<StatusResponse>(`/v1/generation-request/${taskId}/status/`);
      const status = (r.status ?? "").toUpperCase();

      if (status === "FINISHED" || status === "COMPLETED" || status === "SUCCESS") {
        const model = r.results?.find((x) => x.asset && x.asset_type === "3D_MODEL");
        if (model?.asset) {
          const thumb = r.results?.find(
            (x) => x.asset && (x.asset_type === "THUMBNAIL" || x.asset_type === "IMAGE")
          );
          return {
            id: taskId,
            status: "SUCCEEDED",
            progress: 100,
            model_urls: { glb: model.asset },
            thumbnail_url: thumb?.asset,
          };
        }
        // Task de imagen (etapa 1 del pipeline de texto): terminó bien, sin GLB aún.
        if (r.results?.some((x) => x.asset)) {
          return { id: taskId, status: "SUCCEEDED", progress: 100 };
        }
        return {
          id: taskId,
          status: "FAILED",
          progress: 100,
          task_error: { message: "finished without any asset" },
        };
      }

      if (status === "FAILED" || status === "ERROR" || status === "CANCELED") {
        return {
          id: taskId,
          status: "FAILED",
          progress: 0,
          task_error: { message: r.error ?? r.detail ?? "generation failed" },
        };
      }

      const progress =
        typeof r.progress === "number" ? Math.min(99, Math.round(r.progress)) : 0;
      return { id: taskId, status: progress > 0 ? "IN_PROGRESS" : "PENDING", progress };
    });
  }

  async getBalance(): Promise<number> {
    const r = await apiFetch<{ balance: string | number }>("/account/user/wallet/");
    const n = Number(r.balance);
    return Number.isFinite(n) ? n : 0;
  }
}
