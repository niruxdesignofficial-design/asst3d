import { storage, isStoredRef } from "./storage.js";

/**
 * Las URLs de resultados de los proveedores EXPIRAN (3D AI Studio: 1-24h; Meshy
 * también rota las suyas). Para que la galería y las descargas sigan vivas,
 * bajamos el GLB (y el thumbnail si hay) al storage al completar el job.
 * Con R2 configurado los archivos sobreviven deploys; si no, disco local.
 */

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`persist: upstream ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function persistModels(
  generationId: string,
  urls: Record<string, string>,
  thumbnailUrl?: string | null
): Promise<{ urls: Record<string, string>; thumbnailUrl: string | null }> {
  const out = { ...urls };

  const glb = urls.glb;
  if (glb && !glb.startsWith("sample://") && !isStoredRef(glb)) {
    out.glb = await storage.put(`${generationId}.glb`, await download(glb), "model/gltf-binary");
  }

  let thumb: string | null = thumbnailUrl ?? null;
  if (thumb && !isStoredRef(thumb)) {
    try {
      thumb = await storage.put(`${generationId}.thumb.png`, await download(thumb), "image/png");
    } catch {
      thumb = null; // el thumbnail es opcional: el cliente puede renderizarlo del GLB
    }
  }

  return { urls: out, thumbnailUrl: thumb };
}
