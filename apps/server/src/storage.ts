import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";

/**
 * Storage dual para los archivos persistidos (GLBs, thumbnails):
 *  - disco local (default): refs "local://<archivo>"
 *  - Cloudflare R2 (si hay credenciales): refs "r2://<key>" — sobrevive deploys.
 */

export interface ModelStorage {
  /** guarda el buffer y devuelve la ref (local://x o r2://x) */
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  /** stream de lectura para una ref propia; null si la ref no es de este storage */
  stream(ref: string): Promise<Readable | null>;
}

class DiskStorage implements ModelStorage {
  private dir(): string {
    const d = path.join(config.dataDir, "models");
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  async put(key: string, data: Buffer): Promise<string> {
    const dest = path.join(this.dir(), path.basename(key));
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dest);
    return `local://${path.basename(key)}`;
  }

  async stream(ref: string): Promise<Readable | null> {
    if (!ref.startsWith("local://")) return null;
    const file = path.join(this.dir(), path.basename(ref.slice("local://".length)));
    if (!fs.existsSync(file)) return null;
    return fs.createReadStream(file);
  }
}

class R2Storage implements ModelStorage {
  private client: S3Client;
  constructor(private fallback: DiskStorage) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: config.r2Bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
    return `r2://${key}`;
  }

  async stream(ref: string): Promise<Readable | null> {
    // sigue sabiendo leer refs locales viejas (modelos de antes de configurar R2)
    if (ref.startsWith("local://")) return this.fallback.stream(ref);
    if (!ref.startsWith("r2://")) return null;
    const key = ref.slice("r2://".length);
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: config.r2Bucket, Key: key })
      );
      if (!out.Body) return null;
      return out.Body as Readable;
    } catch {
      return null;
    }
  }
}

export function createStorage(): ModelStorage {
  const disk = new DiskStorage();
  if (config.r2AccountId && config.r2AccessKeyId && config.r2SecretAccessKey && config.r2Bucket) {
    return new R2Storage(disk);
  }
  return disk;
}

export const storage = createStorage();

/** true si la ref es de un storage nuestro (persistida) y no una URL upstream. */
export function isStoredRef(url: string): boolean {
  return url.startsWith("local://") || url.startsWith("r2://");
}
