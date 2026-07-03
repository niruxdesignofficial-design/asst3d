import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StabilityFastClient } from "../src/meshy/stability.js";
import type { MeshyClient } from "../src/meshy/types.js";
import type { ModelStorage } from "../src/storage.js";

/** Storage fake en memoria para no tocar disco en los tests. */
function fakeStorage(): ModelStorage & { saved: Map<string, Buffer> } {
  const saved = new Map<string, Buffer>();
  return {
    saved,
    async put(key, data) {
      saved.set(key, data);
      return `db://${key}`;
    },
    async stream() {
      return null;
    },
    async size() {
      return null;
    },
    async delete() {},
  };
}

const GLB = Buffer.from("glTF-fake-binary");
const PNG = Buffer.from("png-fake-image");

function mockFetchOk() {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/stable-image/generate/core")) {
      return new Response(new Uint8Array(PNG), { status: 200 });
    }
    if (u.includes("/3d/stable-fast-3d")) {
      return new Response(new Uint8Array(GLB), { status: 200 });
    }
    if (u.includes("/v1/user/balance")) {
      return Response.json({ credits: 21.5 });
    }
    return new Response("not found", { status: 404 });
  });
}

async function waitDone(client: MeshyClient, id: string) {
  for (let i = 0; i < 50; i++) {
    const t = await client.getTask(id, "text");
    if (t.status === "SUCCEEDED" || t.status === "FAILED") return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout");
}

describe("StabilityFastClient (fast <20s)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchOk());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("texto: imagen sync + SF3D sync, GLB y thumbnail persistidos", async () => {
    const storage = fakeStorage();
    const client = new StabilityFastClient(storage);
    const id = await client.createTextPreview({ prompt: "a red chair", modelType: "standard" });
    const task = await waitDone(client, id);

    expect(task.status).toBe("SUCCEEDED");
    expect(task.model_urls?.glb).toBe(`db://${id}.glb`);
    expect(task.thumbnail_url).toBe(`db://${id}.thumb.png`);
    expect(storage.saved.get(`${id}.glb`)?.equals(GLB)).toBe(true);
    expect(storage.saved.get(`${id}.thumb.png`)?.equals(PNG)).toBe(true);
    expect(client.twoStage).toBe(false); // el poller no encadena refine
  });

  it("imagen: SF3D directo desde el data URI", async () => {
    const storage = fakeStorage();
    const client = new StabilityFastClient(storage);
    const id = await client.createImageTo3D({
      imageDataUri: `data:image/png;base64,${PNG.toString("base64")}`,
      modelType: "standard",
    });
    const task = await waitDone(client, id);
    expect(task.status).toBe("SUCCEEDED");
    expect(storage.saved.get(`${id}.glb`)?.equals(GLB)).toBe(true);
  });

  it("un error del proveedor marca el job FAILED con mensaje", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"errors":["content policy"]}', { status: 403 }))
    );
    const client = new StabilityFastClient(fakeStorage());
    const id = await client.createTextPreview({ prompt: "x", modelType: "standard" });
    const task = await waitDone(client, id);
    expect(task.status).toBe("FAILED");
    expect(task.task_error?.message).toContain("403");
  });

  it("getBalance lee los créditos de la cuenta", async () => {
    const client = new StabilityFastClient(fakeStorage());
    expect(await client.getBalance()).toBe(21.5);
  });

  it("task desconocida (restart del server) responde FAILED, no explota", async () => {
    const client: MeshyClient = new StabilityFastClient(fakeStorage());
    const t = await client.getTask("stab-inexistente", "text");
    expect(t.status).toBe("FAILED");
  });
});
