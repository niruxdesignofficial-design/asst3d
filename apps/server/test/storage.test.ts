import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/index.js";
import { DbStorage, isStoredRef } from "../src/storage.js";
import type { Readable } from "node:stream";

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe("DbStorage (blobs dentro de la DB)", () => {
  it("guarda y streamea un archivo, con ref db://", async () => {
    const db = await openDb(":memory:");
    const storage = new DbStorage(db, {
      put: async () => "local://x",
      stream: async () => null,
      size: async () => null,
      delete: async () => {},
    });

    const data = Buffer.from("glTF-fake-binary-content-1234567890");
    const ref = await storage.put("gen-1.glb", data, "model/gltf-binary");
    expect(ref).toBe("db://gen-1.glb");
    expect(isStoredRef(ref)).toBe(true);

    const stream = await storage.stream(ref);
    expect(stream).not.toBeNull();
    expect((await drain(stream!)).equals(data)).toBe(true);
  });

  it("sobrescribe la misma key sin duplicar y devuelve null si no existe", async () => {
    const db = await openDb(":memory:");
    const storage = new DbStorage(db, {
      put: async () => "x",
      stream: async () => null,
      size: async () => null,
      delete: async () => {},
    });

    await storage.put("k.glb", Buffer.from("v1"), "model/gltf-binary");
    await storage.put("k.glb", Buffer.from("v2-mas-largo"), "model/gltf-binary");
    const out = await drain((await storage.stream("db://k.glb"))!);
    expect(out.toString()).toBe("v2-mas-largo");

    expect(await storage.stream("db://no-existe.glb")).toBeNull();
  });
});
