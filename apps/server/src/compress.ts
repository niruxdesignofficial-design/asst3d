import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

/**
 * Compresión de GLBs antes de persistirlos:
 *  dedup + prune + texturas a WebP 1024 + geometría meshopt (EXT_meshopt_compression).
 * Resultado típico: 5-10x más chico → Neon rinde muchos más modelos y el visor
 * carga en una fracción del tiempo. El visor registra MeshoptDecoder para leerlos.
 */

let io: NodeIO | null = null;

async function getIO(): Promise<NodeIO> {
  if (io) return io;
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.encoder": MeshoptEncoder,
      "meshopt.decoder": MeshoptDecoder,
    });
  return io;
}

export interface CompressResult {
  data: Buffer;
  /** true si se aplicó compresión; false = se devolvió el original (fallback) */
  compressed: boolean;
  inputBytes: number;
  outputBytes: number;
}

export async function compressGlb(input: Buffer): Promise<CompressResult> {
  try {
    const nio = await getIO();
    const doc = await nio.readBinary(new Uint8Array(input));
    await doc.transform(
      dedup(),
      prune(),
      textureCompress({
        encoder: sharp,
        targetFormat: "webp",
        resize: [1024, 1024],
      }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" })
    );
    const out = Buffer.from(await nio.writeBinary(doc));
    // Si por alguna razón quedó más grande, preferir el original.
    if (out.length >= input.length) {
      return { data: input, compressed: false, inputBytes: input.length, outputBytes: input.length };
    }
    return { data: out, compressed: true, inputBytes: input.length, outputBytes: out.length };
  } catch {
    // Nunca perder un modelo por un fallo de compresión: persistir tal cual.
    return { data: input, compressed: false, inputBytes: input.length, outputBytes: input.length };
  }
}
