import { compressGlb } from "./compress.js";
import { getStorage, isStoredRef } from "./storage.js";

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
    // Comprimir antes de guardar (5-10x más chico); si falla, guarda el original.
    const { data } = await compressGlb(await download(glb));
    out.glb = await getStorage().put(`${generationId}.glb`, data, "model/gltf-binary");
  }

  let thumb: string | null = thumbnailUrl ?? null;
  if (thumb && !isStoredRef(thumb)) {
    try {
      thumb = await getStorage().put(
        `${generationId}.thumb.png`,
        await download(thumb),
        "image/png"
      );
    } catch {
      thumb = null; // el thumbnail es opcional: el cliente puede renderizarlo del GLB
    }
  }

  return { urls: out, thumbnailUrl: thumb };
}
