import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { getStorage, type ModelStorage } from "../storage.js";
import type {
  ImageTo3DOptions,
  MeshyClient,
  MeshyTask,
  TextTo3DOptions,
} from "./types.js";

/**
 * Modo Fast REAL (<20s) sobre Stability AI:
 *  - texto→3D: Stable Image Core genera la imagen (sync, ~4-8s) y
 *    Stable Fast 3D la convierte en GLB (sync, ~2-5s).
 *  - imagen→3D: Stable Fast 3D directo.
 * No hay polling upstream: el pipeline corre en el server y este cliente
 * expone el avance como tasks en memoria para encajar con el JobPoller.
 * Costo aprox: imagen 3 créditos + SF3D 2 créditos ≈ USD 0.05 por modelo.
 */

interface FastJob {
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  progress: number;
  /** refs ya persistidas en nuestro storage (db:// | r2:// | local://) */
  glbRef?: string;
  thumbRef?: string;
  error?: string;
  startedAt: number;
}

async function stabilityFetch(path: string, form: FormData, accept: string): Promise<Response> {
  const res = await fetch(`${config.stabilityBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.stabilityApiKey}`,
      Accept: accept,
    },
    body: form,
  });
  if (!res.ok) {
    // Nunca loguear la key; el body de error es seguro (JSON con "errors").
    const body = await res.text().catch(() => "");
    throw new Error(`stability ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

export class StabilityFastClient implements MeshyClient {
  readonly twoStage = false;
  private jobs = new Map<string, FastJob>();

  constructor(private storage: ModelStorage = getStorage()) {}

  private startJob(): { id: string; job: FastJob } {
    const id = `stab-${randomUUID()}`;
    const job: FastJob = { status: "IN_PROGRESS", progress: 5, startedAt: Date.now() };
    this.jobs.set(id, job);
    // limpiar jobs terminados viejos para no acumular memoria
    setTimeout(() => this.jobs.delete(id), 30 * 60_000).unref?.();
    return { id, job };
  }

  /** Paso texto→imagen: Stable Image Core (sync). */
  private async generateImage(prompt: string): Promise<Buffer> {
    const form = new FormData();
    form.set(
      "prompt",
      `${prompt}, single object centered on a plain dark studio background, 3/4 view, even lighting`
    );
    form.set("aspect_ratio", "1:1");
    form.set("output_format", "png");
    const res = await stabilityFetch("/v2beta/stable-image/generate/core", form, "image/*");
    return Buffer.from(await res.arrayBuffer());
  }

  /** Paso imagen→3D: Stable Fast 3D (sync, devuelve el GLB binario). */
  private async imageTo3D(image: Buffer): Promise<Buffer> {
    const form = new FormData();
    form.set("image", new Blob([new Uint8Array(image)], { type: "image/png" }), "input.png");
    form.set("texture_resolution", "1024");
    const res = await stabilityFetch("/v2beta/3d/stable-fast-3d", form, "*/*");
    return Buffer.from(await res.arrayBuffer());
  }

  private async runText(id: string, job: FastJob, prompt: string): Promise<void> {
    try {
      const image = await this.generateImage(prompt);
      job.progress = 55;
      // la imagen generada es el thumbnail perfecto para la galería
      this.storage
        .put(`${id}.thumb.png`, image, "image/png")
        .then((ref) => (job.thumbRef = ref))
        .catch(() => {});
      const glb = await this.imageTo3D(image);
      job.progress = 90;
      job.glbRef = await this.storage.put(`${id}.glb`, glb, "model/gltf-binary");
      job.status = "SUCCEEDED";
      job.progress = 100;
    } catch (err) {
      job.status = "FAILED";
      job.error = String((err as Error).message ?? err).slice(0, 300);
    }
  }

  private async runImage(id: string, job: FastJob, imageDataUri: string): Promise<void> {
    try {
      const base64 = imageDataUri.replace(/^data:[a-z/+.-]+;base64,/i, "");
      job.progress = 30;
      const glb = await this.imageTo3D(Buffer.from(base64, "base64"));
      job.progress = 90;
      job.glbRef = await this.storage.put(`${id}.glb`, glb, "model/gltf-binary");
      job.status = "SUCCEEDED";
      job.progress = 100;
    } catch (err) {
      job.status = "FAILED";
      job.error = String((err as Error).message ?? err).slice(0, 300);
    }
  }

  async createTextPreview(opts: TextTo3DOptions): Promise<string> {
    const { id, job } = this.startJob();
    void this.runText(id, job, opts.prompt);
    return id;
  }

  async createTextRefine(previewTaskId: string): Promise<string> {
    // Un solo paso: no aplica (twoStage=false).
    return previewTaskId;
  }

  async createImageTo3D(opts: ImageTo3DOptions): Promise<string> {
    const { id, job } = this.startJob();
    void this.runImage(id, job, opts.imageDataUri);
    return id;
  }

  async getTask(taskId: string): Promise<MeshyTask> {
    const job = this.jobs.get(taskId);
    if (!job) {
      return {
        id: taskId,
        status: "FAILED",
        progress: 0,
        task_error: { message: "fast job lost (server restarted mid-generation)" },
      };
    }
    if (job.status === "SUCCEEDED") {
      return {
        id: taskId,
        status: "SUCCEEDED",
        progress: 100,
        // ya persistido: persistModels lo deja pasar tal cual (isStoredRef)
        model_urls: { glb: job.glbRef! },
        thumbnail_url: job.thumbRef,
      };
    }
    if (job.status === "FAILED") {
      return {
        id: taskId,
        status: "FAILED",
        progress: job.progress,
        task_error: { message: job.error ?? "fast generation failed" },
      };
    }
    return { id: taskId, status: "IN_PROGRESS", progress: job.progress };
  }

  async getBalance(): Promise<number> {
    const res = await fetch(`${config.stabilityBaseUrl}/v1/user/balance`, {
      headers: { Authorization: `Bearer ${config.stabilityApiKey}` },
    });
    if (!res.ok) throw new Error(`stability balance -> ${res.status}`);
    const j = (await res.json()) as { credits?: number };
    return Number(j.credits ?? 0);
  }
}
