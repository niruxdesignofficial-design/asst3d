import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";
import type { DbDriver } from "./db/driver.js";

/**
 * Storage para los archivos persistidos (GLBs, thumbnails). Prioridad:
 *  1. Cloudflare R2 (si hay credenciales) — refs "r2://<key>"
 *  2. La propia base de datos (si hay DATABASE_URL) — refs "db://<key>"
 *     Sin cuentas extra: los modelos viven en Neon junto con los datos.
 *  3. Disco local (default en dev) — refs "local://<archivo>"
 */

export interface ModelStorage {
  /** guarda el buffer y devuelve la ref */
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  /** stream de lectura para una ref persistida; null si no existe */
  stream(ref: string): Promise<Readable | null>;
  /** tamaño en bytes si es conocible barato; null si no */
  size(ref: string): Promise<number | null>;
  /** borra el archivo de la ref (si existe); silencioso si no */
  delete(ref: string): Promise<void>;
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

  async size(ref: string): Promise<number | null> {
    if (!ref.startsWith("local://")) return null;
    const file = path.join(this.dir(), path.basename(ref.slice("local://".length)));
    try {
      return fs.statSync(file).size;
    } catch {
      return null;
    }
  }

  async delete(ref: string): Promise<void> {
    if (!ref.startsWith("local://")) return;
    const file = path.join(this.dir(), path.basename(ref.slice("local://".length)));
    try {
      fs.unlinkSync(file);
    } catch {
      /* ya no existe */
    }
  }
}

/** Blobs dentro de la DB (tabla blobs): sobrevive discos efímeros sin cuentas extra. */
export class DbStorage implements ModelStorage {
  constructor(
    private db: DbDriver,
    private fallback: ModelStorage
  ) {}

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.db.run(
      `INSERT INTO blobs (key, content_type, data, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET data = excluded.data, content_type = excluded.content_type`,
      [key, contentType, data, Date.now()]
    );
    return `db://${key}`;
  }

  async stream(ref: string): Promise<Readable | null> {
    if (ref.startsWith("local://")) return this.fallback.stream(ref);
    if (!ref.startsWith("db://")) return null;
    const key = ref.slice("db://".length);
    const row = await this.db.get<{ data: Buffer }>(`SELECT data FROM blobs WHERE key = ?`, [
      key,
    ]);
    if (!row?.data) return null;
    return Readable.from(Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data));
  }

  async size(ref: string): Promise<number | null> {
    if (ref.startsWith("local://")) return this.fallback.size(ref);
    if (!ref.startsWith("db://")) return null;
    const row = await this.db.get<{ n: number }>(
      `SELECT length(data) AS n FROM blobs WHERE key = ?`,
      [ref.slice("db://".length)]
    );
    return row?.n ?? null;
  }

  async delete(ref: string): Promise<void> {
    if (ref.startsWith("local://")) return this.fallback.delete(ref);
    if (!ref.startsWith("db://")) return;
    await this.db.run(`DELETE FROM blobs WHERE key = ?`, [ref.slice("db://".length)]);
  }
}

class R2Storage implements ModelStorage {
  private client: S3Client;
  constructor(private fallback: ModelStorage) {
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
    // sigue sabiendo leer refs de los otros storages (archivos de antes del cambio)
    if (!ref.startsWith("r2://")) return this.fallback.stream(ref);
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

  async size(ref: string): Promise<number | null> {
    if (!ref.startsWith("r2://")) return this.fallback.size(ref);
    return null; // HeadObject por pedido no vale la pena; el guard del cliente tolera null
  }

  async delete(ref: string): Promise<void> {
    if (!ref.startsWith("r2://")) return this.fallback.delete(ref);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: config.r2Bucket, Key: ref.slice("r2://".length) })
      );
    } catch {
      /* mejor dejar un huérfano que fallar el borrado */
    }
  }
}

let active: ModelStorage = new DiskStorage();

/** Se llama una vez al boot, cuando ya existe la conexión a la DB. */
export function initStorage(db: DbDriver): ModelStorage {
  const disk = new DiskStorage();
  const hasR2 =
    config.r2AccountId && config.r2AccessKeyId && config.r2SecretAccessKey && config.r2Bucket;
  if (hasR2) {
    active = new R2Storage(new DbStorage(db, disk));
  } else if (config.databaseUrl) {
    active = new DbStorage(db, disk);
  } else {
    active = disk;
  }
  return active;
}

export function getStorage(): ModelStorage {
  return active;
}

/** true si la ref es de un storage nuestro (persistida) y no una URL upstream. */
export function isStoredRef(url: string): boolean {
  return url.startsWith("local://") || url.startsWith("r2://") || url.startsWith("db://");
}
