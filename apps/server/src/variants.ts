import { compressGlb } from "./compress.js";
import type { Repo } from "./db/repo.js";
import type { MeshyClient } from "./meshy/types.js";
import { getStorage } from "./storage.js";

/**
 * Export presets game-dev: remesh del modelo a un polycount objetivo via Meshy,
 * cacheado en storage como variante ({id}.mobile.glb / {id}.pc.glb).
 * Corre como job liviano en memoria (30-90s típicos), con un solo intento por
 * preset a la vez y refund del cupo si falla.
 */

export const EXPORT_PRESETS = {
  mobile: 5000,
  pc: 30000,
} as const;
export type ExportPreset = keyof typeof EXPORT_PRESETS;

const pending = new Set<string>();

export function isVariantPending(genId: string, preset: ExportPreset): boolean {
  return pending.has(`${genId}:${preset}`);
}

export async function startVariant(
  repo: Repo,
  meshy: MeshyClient,
  genId: string,
  preset: ExportPreset,
  onFail?: () => Promise<void>
): Promise<void> {
  const key = `${genId}:${preset}`;
  if (pending.has(key)) return;
  pending.add(key);

  const finish = () => pending.delete(key);

  try {
    const row = await repo.getGeneration(genId);
    if (!row?.meshy_task_id) throw new Error("generation has no provider task");
    if (!meshy.createRemesh) throw new Error("provider does not support remesh");
    const remeshId = await meshy.createRemesh(row.meshy_task_id, EXPORT_PRESETS[preset]);

    const startedAt = Date.now();
    const poll = async (): Promise<void> => {
      try {
        if (Date.now() - startedAt > 8 * 60_000) throw new Error("remesh timeout");
        const task = await meshy.getTask(remeshId, "text");
        if (task.status === "FAILED" || task.status === "CANCELED")
          throw new Error(task.task_error?.message ?? "remesh failed");
        if (task.status !== "SUCCEEDED" || !task.model_urls?.glb) {
          setTimeout(() => void poll(), 5000).unref?.();
          return;
        }
        // listo: descargar, comprimir y cachear como variante
        const res = await fetch(task.model_urls.glb);
        if (!res.ok) throw new Error(`variant download ${res.status}`);
        const { data } = await compressGlb(Buffer.from(await res.arrayBuffer()));
        const ref = await getStorage().put(`${genId}.${preset}.glb`, data, "model/gltf-binary");
        const fresh = await repo.getGeneration(genId);
        const variants = fresh?.variants ? JSON.parse(fresh.variants) : {};
        variants[preset] = ref;
        await repo.updateGeneration(genId, { variants: JSON.stringify(variants) });
        finish();
      } catch (err) {
        finish();
        await onFail?.().catch(() => {});
        await repo
          .updateGeneration(genId, {}) // no tocar el modelo original
          .catch(() => {});
        void err;
      }
    };
    setTimeout(() => void poll(), 5000).unref?.();
  } catch (err) {
    finish();
    await onFail?.().catch(() => {});
    throw err;
  }
}
