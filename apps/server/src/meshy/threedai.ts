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
  imageBase64?: string;
  modelType: "standard" | "lowpoly";
  targetPolycount?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: "3.1",
    enable_pbr: true,
    generate_type: opts.modelType === "lowpoly" ? "LowPoly" : "Normal",
  };
  if (opts.prompt) body.prompt = opts.prompt.slice(0, 1024);
  if (opts.imageBase64) body.image = opts.imageBase64;
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
    // La API espera base64 pelado, sin el prefijo data:...;base64,
    const base64 = opts.imageDataUri.replace(/^data:[a-z/+.-]+;base64,/i, "");
    const r = await apiFetch<SubmitResponse>("/v1/3d-models/tencent/generate/pro/", {
      method: "POST",
      body: JSON.stringify(
        proBody({
          imageBase64: base64,
          modelType: opts.modelType,
          targetPolycount: opts.targetPolycount,
        })
      ),
    });
    return r.task_id;
  }

  async getTask(taskId: string): Promise<MeshyTask> {
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
      return {
        id: taskId,
        status: "SUCCEEDED",
        progress: 100,
        model_urls: { glb: model.asset },
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
    const progress = typeof r.progress === "number" ? Math.min(99, Math.round(r.progress)) : 0;
    return {
      id: taskId,
      status: progress > 0 ? "IN_PROGRESS" : "PENDING",
      progress,
    };
  }

  async getBalance(): Promise<number> {
    // GET /account/user/wallet/ -> { "balance": "150.00" }
    const r = await apiFetch<{ balance: string | number }>("/account/user/wallet/");
    const n = Number(r.balance);
    return Number.isFinite(n) ? n : 0;
  }
}
