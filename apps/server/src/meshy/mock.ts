import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type {
  ImageTo3DOptions,
  MeshyClient,
  MeshyTask,
  TextTo3DOptions,
} from "./types.js";

/**
 * Mock de Meshy para desarrollar sin gastar créditos.
 * Simula una task que progresa en ~6s y termina apuntando a un GLB
 * de muestra servido por el propio server en /api/samples/<archivo>.
 */
export class MockMeshyClient implements MeshyClient {
  private tasks = new Map<string, { startedAt: number; sample: string }>();
  private samples: string[];
  private durationMs: number;

  constructor(durationMs = 6000) {
    this.durationMs = durationMs;
    this.samples = fs.existsSync(config.samplesDir)
      ? fs.readdirSync(config.samplesDir).filter((f) => f.endsWith(".glb"))
      : [];
  }

  private start(seed: string): string {
    const id = `mock-${randomUUID()}`;
    // Determinístico por seed para que el mismo prompt dé el mismo modelo.
    let hash = 0;
    for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const sample = this.samples.length
      ? this.samples[hash % this.samples.length]
      : "";
    this.tasks.set(id, { startedAt: Date.now(), sample });
    return id;
  }

  async createTextPreview(opts: TextTo3DOptions): Promise<string> {
    return this.start(opts.prompt);
  }

  async createTextRefine(previewTaskId: string): Promise<string> {
    return this.start(previewTaskId);
  }

  async createImageTo3D(opts: ImageTo3DOptions): Promise<string> {
    return this.start(opts.imageDataUri.slice(0, 64));
  }

  async getTask(taskId: string): Promise<MeshyTask> {
    const t = this.tasks.get(taskId);
    if (!t) return { id: taskId, status: "FAILED", progress: 0, task_error: { message: "unknown mock task" } };
    const elapsed = Date.now() - t.startedAt;
    const progress = Math.min(100, Math.round((elapsed / this.durationMs) * 100));
    if (progress < 100) {
      return { id: taskId, status: progress === 0 ? "PENDING" : "IN_PROGRESS", progress };
    }
    if (!t.sample) {
      return { id: taskId, status: "FAILED", progress: 100, task_error: { message: "no sample models available" } };
    }
    const base = `sample://${t.sample}`;
    return {
      id: taskId,
      status: "SUCCEEDED",
      progress: 100,
      // El poller entiende sample:// y lo resuelve a un archivo local.
      model_urls: { glb: base, fbx: base, obj: base, usdz: base },
    };
  }

  async getBalance(): Promise<number> {
    return 1000;
  }
}

/** Resuelve una URL sample:// a la ruta del archivo local, o null si no es sample. */
export function resolveSampleUrl(url: string): string | null {
  if (!url.startsWith("sample://")) return null;
  const file = path.basename(url.slice("sample://".length));
  return path.join(config.samplesDir, file);
}
