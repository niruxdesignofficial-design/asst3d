import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/index.js";
import { Repo } from "../src/db/repo.js";
import { JobPoller } from "../src/poller.js";
import type { MeshyClient, MeshyTask } from "../src/meshy/types.js";

class ScriptedMeshy implements MeshyClient {
  twoStage = true;
  tasks = new Map<string, MeshyTask>();
  refineCreated: string[] = [];
  private seq = 0;

  set(id: string, task: Partial<MeshyTask>): void {
    this.tasks.set(id, { id, status: "PENDING", progress: 0, ...task });
  }
  async createTextPreview(): Promise<string> {
    const id = `preview-${++this.seq}`;
    this.set(id, {});
    return id;
  }
  async createTextRefine(previewId: string): Promise<string> {
    const id = `refine-${++this.seq}`;
    this.refineCreated.push(previewId);
    this.set(id, {});
    return id;
  }
  async createImageTo3D(): Promise<string> {
    const id = `img-${++this.seq}`;
    this.set(id, {});
    return id;
  }
  async getTask(taskId: string): Promise<MeshyTask> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`unknown task ${taskId}`);
    return t;
  }
  async getBalance(): Promise<number> {
    return 1000;
  }
}

describe("JobPoller", () => {
  let repo: Repo;
  let meshy: ScriptedMeshy;
  let poller: JobPoller;

  beforeEach(async () => {
    repo = new Repo(await openDb(":memory:"));
    meshy = new ScriptedMeshy();
    poller = new JobPoller(repo, meshy);
    await repo.upsertUser("u1", null);
  });

  async function newTextGen() {
    return repo.createGeneration({
      userId: "u1",
      kind: "text",
      prompt: "un robot",
      styleId: "lowpoly",
      modelType: "lowpoly",
      isPublic: true,
    });
  }

  it("avanza progreso durante preview (0-50%)", async () => {
    const row = await newTextGen();
    await repo.updateGeneration(row.id, { meshy_task_id: "p1", status: "processing" });
    meshy.set("p1", { status: "IN_PROGRESS", progress: 60 });
    await poller.tick();
    const g = (await repo.getGeneration(row.id))!;
    expect(g.status).toBe("processing");
    expect(g.progress).toBe(30); // 60% de preview = 30% total
  });

  it("al terminar preview encadena refine automáticamente", async () => {
    const row = await newTextGen();
    await repo.updateGeneration(row.id, { meshy_task_id: "p1", status: "processing" });
    meshy.set("p1", { status: "SUCCEEDED", progress: 100 });
    await poller.tick();
    const g = (await repo.getGeneration(row.id))!;
    expect(meshy.refineCreated).toEqual(["p1"]);
    expect(g.stage).toBe("refine");
    expect(g.status).toBe("processing");
    expect(g.progress).toBe(50);
  });

  it("preview progresivo: publica el GLB del preview mientras texturiza", async () => {
    const persist = async (id: string, urls: Record<string, string>) => ({
      urls: { ...urls, glb: `db://${id}.glb` },
      thumbnailUrl: null,
    });
    const p = new JobPoller(repo, meshy, 3000, persist);
    const row = await newTextGen();
    await repo.updateGeneration(row.id, { meshy_task_id: "p1", status: "processing" });
    meshy.set("p1", {
      status: "SUCCEEDED",
      progress: 100,
      model_urls: { glb: "https://meshy/preview.glb" },
    });
    await p.tick();
    const g = (await repo.getGeneration(row.id))!;
    // sigue procesando (refine encadenado) pero el visor ya tiene modelo
    expect(g.status).toBe("processing");
    expect(g.stage).toBe("refine");
    expect(JSON.parse(g.model_urls!).glb).toBe(`db://${row.id}.glb`);
    const dto = await repo.toDto(g);
    expect(dto.viewerUrl).toBe(`/api/generations/${g.id}/model.glb`);
  });

  it("al terminar refine guarda las model_urls y marca done", async () => {
    const row = await newTextGen();
    await repo.updateGeneration(row.id, {
      meshy_task_id: "r1",
      stage: "refine",
      status: "processing",
    });
    meshy.set("r1", {
      status: "SUCCEEDED",
      progress: 100,
      model_urls: { glb: "https://x/m.glb", fbx: "https://x/m.fbx" },
      thumbnail_url: "https://x/t.png",
    });
    await poller.tick();
    const g = (await repo.getGeneration(row.id))!;
    expect(g.status).toBe("done");
    expect(g.progress).toBe(100);
    expect(JSON.parse(g.model_urls!)).toEqual({
      glb: "https://x/m.glb",
      fbx: "https://x/m.fbx",
    });
    const dto = await repo.toDto(g);
    expect(dto.formats).toEqual(["glb", "fbx"]);
    expect(dto.viewerUrl).toBe(`/api/generations/${g.id}/model.glb`);
  });

  it("una task de imagen no encadena refine: done directo", async () => {
    const row = await repo.createGeneration({
      userId: "u1",
      kind: "image",
      prompt: null,
      styleId: "realistic",
      modelType: "standard",
      isPublic: true,
    });
    await repo.updateGeneration(row.id, { meshy_task_id: "i1", status: "processing" });
    meshy.set("i1", { status: "SUCCEEDED", progress: 100, model_urls: { glb: "https://x/i.glb" } });
    await poller.tick();
    const g = (await repo.getGeneration(row.id))!;
    expect(g.status).toBe("done");
    expect(meshy.refineCreated).toHaveLength(0);
  });

  it("usa el cliente del provider de la fila (fast) y el default para el resto", async () => {
    const fastMeshy = new ScriptedMeshy();
    const pollerWithFast = new JobPoller(repo, meshy, 3000, undefined, { fast: fastMeshy });

    // fila fast -> debe consultar al cliente fast
    const fastRow = await repo.createGeneration({
      userId: "u1", kind: "text", prompt: "fast robot", styleId: "lowpoly",
      modelType: "lowpoly", isPublic: true, provider: "fast",
    });
    await repo.updateGeneration(fastRow.id, { meshy_task_id: "f1", status: "processing" });
    fastMeshy.set("f1", { status: "IN_PROGRESS", progress: 80 });

    // fila normal -> cliente default
    const normalRow = await newTextGen();
    await repo.updateGeneration(normalRow.id, { meshy_task_id: "n1", status: "processing" });
    meshy.set("n1", { status: "IN_PROGRESS", progress: 20 });

    await pollerWithFast.tick();
    expect((await repo.getGeneration(fastRow.id))!.progress).toBe(40); // 80% de preview
    expect((await repo.getGeneration(normalRow.id))!.progress).toBe(10);

    // al terminar el preview fast, el refine se encadena en el cliente FAST
    fastMeshy.set("f1", { status: "SUCCEEDED", progress: 100 });
    await pollerWithFast.tick();
    expect(fastMeshy.refineCreated).toEqual(["f1"]);
    expect(meshy.refineCreated).toHaveLength(0);
  });

  it("proveedor de un paso (twoStage=false): texto termina sin encadenar refine", async () => {
    meshy.twoStage = false; // como 3D AI Studio
    const row = await newTextGen();
    await repo.updateGeneration(row.id, { meshy_task_id: "p1", status: "processing" });
    meshy.set("p1", { status: "SUCCEEDED", progress: 100, model_urls: { glb: "https://x/one.glb" } });
    await poller.tick();
    const g = (await repo.getGeneration(row.id))!;
    expect(g.status).toBe("done");
    expect(meshy.refineCreated).toHaveLength(0);
    expect(JSON.parse(g.model_urls!).glb).toBe("https://x/one.glb");
  });

  it("marca failed con el mensaje de error de Meshy y reembolsa el cupo", async () => {
    await repo.incrementUsage("u1", null, "gen-previa");
    const row = await newTextGen();
    await repo.updateGeneration(row.id, { meshy_task_id: "p1", status: "processing" });
    meshy.set("p1", { status: "FAILED", progress: 10, task_error: { message: "nsfw prompt" } });
    await poller.tick();
    const g = (await repo.getGeneration(row.id))!;
    expect(g.status).toBe("failed");
    expect(g.error).toBe("nsfw prompt");
    // el fallo devolvió el uso
    expect((await repo.getUser("u1"))!.generations_used).toBe(0);
  });

  it("tolera errores de red transitorios y recién falla tras varios seguidos", async () => {
    const row = await newTextGen();
    await repo.updateGeneration(row.id, { meshy_task_id: "desconocida", status: "processing" });
    // Los primeros ticks con error NO matan el job (transitorios)...
    for (let i = 0; i < 4; i++) {
      await poller.tick();
      expect((await repo.getGeneration(row.id))!.status).toBe("processing");
    }
    // ...el quinto error consecutivo sí.
    await poller.tick();
    const g = (await repo.getGeneration(row.id))!;
    expect(g.status).toBe("failed");
    expect(g.error).toContain("unknown task");
  });

  it("un error transitorio no acumula si después se recupera", async () => {
    const row = await newTextGen();
    await repo.updateGeneration(row.id, { meshy_task_id: "flaky", status: "processing" });
    await poller.tick(); // error 1 (task desconocida)
    expect((await repo.getGeneration(row.id))!.status).toBe("processing");
    meshy.set("flaky", { status: "IN_PROGRESS", progress: 40 }); // se recupera
    await poller.tick();
    expect((await repo.getGeneration(row.id))!.progress).toBeGreaterThan(0);
    // el contador se reseteó: harían falta 5 errores nuevos para fallar
    meshy.tasks.delete("flaky");
    for (let i = 0; i < 4; i++) await poller.tick();
    expect((await repo.getGeneration(row.id))!.status).toBe("processing");
  });

  it("los 429 del proveedor no cuentan como errores del job", async () => {
    const row = await newTextGen();
    await repo.updateGeneration(row.id, { meshy_task_id: "th1", status: "processing" });
    meshy.getTask = async () => {
      throw new Error("3daistudio -> 429: RATE_LIMITED");
    };
    for (let i = 0; i < 10; i++) await poller.tick();
    expect((await repo.getGeneration(row.id))!.status).toBe("processing");
  });
});
