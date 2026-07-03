import { config } from "../config.js";
import type {
  ImageTo3DOptions,
  MeshyClient,
  MeshyTask,
  TextTo3DOptions,
} from "./types.js";

async function meshyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.meshyBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.meshyApiKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // Nunca loguear la key; el body de error de Meshy es seguro.
    const body = await res.text().catch(() => "");
    throw new Error(`Meshy ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export class RealMeshyClient implements MeshyClient {
  readonly twoStage = true;

  async createTextPreview(opts: TextTo3DOptions): Promise<string> {
    const body: Record<string, unknown> = {
      mode: "preview",
      prompt: opts.prompt,
      // meshy-5 = 5 créditos el preview; "latest" (meshy-6) = 20
      ai_model: opts.aiModel ?? "meshy-5",
      model_type: opts.modelType,
      target_formats: ["glb", "fbx", "obj", "usdz"],
    };
    if (opts.targetPolycount) {
      body.topology = "triangle";
      body.target_polycount = opts.targetPolycount;
    }
    const r = await meshyFetch<{ result: string }>("/openapi/v2/text-to-3d", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return r.result;
  }

  async createTextRefine(previewTaskId: string): Promise<string> {
    const r = await meshyFetch<{ result: string }>("/openapi/v2/text-to-3d", {
      method: "POST",
      body: JSON.stringify({
        mode: "refine",
        preview_task_id: previewTaskId,
        enable_pbr: true,
      }),
    });
    return r.result;
  }

  async createImageTo3D(opts: ImageTo3DOptions): Promise<string> {
    const body: Record<string, unknown> = {
      image_url: opts.imageDataUri,
      ai_model: opts.aiModel ?? "meshy-5",
      model_type: opts.modelType,
      should_texture: true,
      enable_pbr: true,
      target_formats: ["glb", "fbx", "obj", "usdz"],
    };
    if (opts.targetPolycount) {
      body.should_remesh = true;
      body.topology = "triangle";
      body.target_polycount = opts.targetPolycount;
    }
    const r = await meshyFetch<{ result: string }>("/openapi/v1/image-to-3d", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return r.result;
  }

  /**
   * Remesh a un polycount objetivo sobre una task terminada (export presets).
   * Devuelve el id con prefijo para que getTask sepa qué endpoint consultar.
   */
  async createRemesh(inputTaskId: string, targetPolycount: number): Promise<string> {
    const r = await meshyFetch<{ result: string }>("/openapi/v1/remesh", {
      method: "POST",
      body: JSON.stringify({
        input_task_id: inputTaskId,
        target_formats: ["glb"],
        topology: "triangle",
        target_polycount: targetPolycount,
      }),
    });
    return `remesh:${r.result}`;
  }

  /** Nuevas texturas sobre una malla existente (mucho más barato que regenerar). */
  async createRetexture(inputTaskId: string, stylePrompt: string): Promise<string> {
    const r = await meshyFetch<{ result: string }>("/openapi/v1/retexture", {
      method: "POST",
      body: JSON.stringify({
        input_task_id: inputTaskId,
        text_style_prompt: stylePrompt.slice(0, 600),
        ai_model: "meshy-5",
        enable_original_uv: true,
        target_formats: ["glb", "fbx", "obj", "usdz"],
      }),
    });
    return `retex:${r.result}`;
  }

  async getTask(taskId: string, kind: "text" | "image"): Promise<MeshyTask> {
    // Los ids con prefijo vienen de las tasks de post-procesado.
    if (taskId.startsWith("remesh:"))
      return meshyFetch<MeshyTask>(`/openapi/v1/remesh/${taskId.slice("remesh:".length)}`);
    if (taskId.startsWith("retex:"))
      return meshyFetch<MeshyTask>(`/openapi/v1/retexture/${taskId.slice("retex:".length)}`);
    const path =
      kind === "text"
        ? `/openapi/v2/text-to-3d/${taskId}`
        : `/openapi/v1/image-to-3d/${taskId}`;
    return meshyFetch<MeshyTask>(path);
  }

  async getBalance(): Promise<number> {
    const r = await meshyFetch<{ balance: number }>("/openapi/v1/balance");
    return r.balance;
  }
}
