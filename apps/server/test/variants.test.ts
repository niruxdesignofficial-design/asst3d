import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealMeshyClient } from "../src/meshy/client.js";

/** getTask con ids prefijados debe pegarle al endpoint correcto de Meshy. */
describe("post-procesado Meshy: ruteo de tasks remesh/retexture", () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        calls.push(String(url));
        return Response.json({ id: "x", status: "IN_PROGRESS", progress: 10, result: "task-1" });
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("createRemesh devuelve id prefijado y getTask consulta /remesh/:id", async () => {
    const client = new RealMeshyClient();
    const id = await client.createRemesh("orig-task", 5000);
    expect(id).toBe("remesh:task-1");
    expect(calls[0]).toContain("/openapi/v1/remesh");

    await client.getTask(id, "text");
    expect(calls[1]).toContain("/openapi/v1/remesh/task-1");
  });

  it("createRetexture devuelve id prefijado y getTask consulta /retexture/:id", async () => {
    const client = new RealMeshyClient();
    const id = await client.createRetexture("orig-task", "gold plated");
    expect(id).toBe("retex:task-1");
    expect(calls[0]).toContain("/openapi/v1/retexture");

    await client.getTask(id, "text");
    expect(calls[1]).toContain("/openapi/v1/retexture/task-1");
  });

  it("las tasks normales siguen yendo a text-to-3d / image-to-3d", async () => {
    const client = new RealMeshyClient();
    await client.getTask("abc", "text");
    await client.getTask("abc", "image");
    expect(calls[0]).toContain("/openapi/v2/text-to-3d/abc");
    expect(calls[1]).toContain("/openapi/v1/image-to-3d/abc");
  });
});
