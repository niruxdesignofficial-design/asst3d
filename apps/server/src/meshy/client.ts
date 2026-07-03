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
      ai_model: opts.aiModel ?? "latest",
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

  async getTask(taskId: string, kind: "text" | "image"): Promise<MeshyTask> {
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
