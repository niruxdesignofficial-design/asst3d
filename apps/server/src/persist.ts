import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { config } from "./config.js";

/**
 * Las URLs de resultados de los proveedores EXPIRAN (3D AI Studio: 24h; Meshy
 * también rota las suyas). Para que la galería y las descargas sigan vivas,
 * bajamos el GLB a disco al completar el job y lo referenciamos como local://.
 * Los demás formatos quedan con su URL upstream (sirven para descarga inmediata).
 */

export function modelsDir(): string {
  const dir = path.join(config.dataDir, "models");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resuelve una URL local://<archivo> a su ruta en disco, o null si no es local. */
export function resolveLocalUrl(url: string): string | null {
  if (!url.startsWith("local://")) return null;
  const file = path.basename(url.slice("local://".length));
  return path.join(modelsDir(), file);
}

export async function persistModels(
  generationId: string,
  urls: Record<string, string>
): Promise<Record<string, string>> {
  const out = { ...urls };
  const glb = urls.glb;
  // sample:// (mock) ya es local y estable; no hay nada que persistir.
  if (!glb || glb.startsWith("sample://") || glb.startsWith("local://")) return out;

  const file = `${generationId}.glb`;
  const dest = path.join(modelsDir(), file);
  const tmp = `${dest}.tmp`;
  const res = await fetch(glb);
  if (!res.ok || !res.body) throw new Error(`persist: upstream ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    fs.createWriteStream(tmp)
  );
  fs.renameSync(tmp, dest);
  out.glb = `local://${file}`;
  return out;
}
