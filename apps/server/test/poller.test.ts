import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/index.js";
import { Repo } from "../src/db/repo.js";
import { JobPoller } from "../src/poller.js";
import type { MeshyClient, MeshyTask } from "../src/meshy/types.js";

class ScriptedMeshy implements MeshyClient {
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

  beforeEach(() => {
    repo = new Repo(openDb(":memory:"));
    meshy = new ScriptedMeshy();
    poller = new JobPoller(repo, meshy);
    repo.upsertUser("u1", null);
  });

  function newTextGen() {
    const row = repo.createGeneration({
      userId: "u1",
      kind: "text",
      prompt: "un robot",
      styleId: "lowpoly",
      modelType: "lowpoly",
      isPublic: true,
    });
    return row;
  }

  it("avanza progreso durante preview (0-50%)", async () => {
    const row = newTextGen();
    repo.updateGeneration(row.id, { meshy_task_id: "p1", status: "processing" });
    meshy.set("p1", { status: "IN_PROGRESS", progress: 60 });
    await poller.tick();
    const g = repo.getGeneration(row.id)!;
    expect(g.status).toBe("processing");
    expect(g.progress).toBe(30); // 60% de preview = 30% total
  });

  it("al terminar preview encadena refine automáticamente", async () => {
    const row = newTextGen();
    repo.updateGeneration(row.id, { meshy_task_id: "p1", status: "processing" });
    meshy.set("p1", { status: "SUCCEEDED", progress: 100 });
    await poller.tick();
    const g = repo.getGeneration(row.id)!;
    expect(meshy.refineCreated).toEqual(["p1"]);
    expect(g.stage).toBe("refine");
    expect(g.status).toBe("processing");
    expect(g.progress).toBe(50);
  });

  it("al terminar refine guarda las model_urls y marca done", async () => {
    const row = newTextGen();
    repo.updateGeneration(row.id, {
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
    const g = repo.getGeneration(row.id)!;
    expect(g.status).toBe("done");
    expect(g.progress).toBe(100);
    expect(JSON.parse(g.model_urls!)).toEqual({
      glb: "https://x/m.glb",
      fbx: "https://x/m.fbx",
    });
    const dto = repo.toDto(g);
    expect(dto.formats).toEqual(["glb", "fbx"]);
    expect(dto.viewerUrl).toBe(`/api/generations/${g.id}/model.glb`);
  });

  it("una task de imagen no encadena refine: done directo", async () => {
    const row = repo.createGeneration({
      userId: "u1",
      kind: "image",
      prompt: null,
      styleId: "realista",
      modelType: "standard",
      isPublic: true,
    });
    repo.updateGeneration(row.id, { meshy_task_id: "i1", status: "processing" });
    meshy.set("i1", { status: "SUCCEEDED", progress: 100, model_urls: { glb: "https://x/i.glb" } });
    await poller.tick();
    const g = repo.getGeneration(row.id)!;
    expect(g.status).toBe("done");
    expect(meshy.refineCreated).toHaveLength(0);
  });

  it("marca failed con el mensaje de error de Meshy", async () => {
    const row = newTextGen();
    repo.updateGeneration(row.id, { meshy_task_id: "p1", status: "processing" });
    meshy.set("p1", { status: "FAILED", progress: 10, task_error: { message: "nsfw prompt" } });
    await poller.tick();
    const g = repo.getGeneration(row.id)!;
    expect(g.status).toBe("failed");
    expect(g.error).toBe("nsfw prompt");
  });

  it("si Meshy tira error de red, el job falla controladamente (no explota el tick)", async () => {
    const row = newTextGen();
    repo.updateGeneration(row.id, { meshy_task_id: "desconocida", status: "processing" });
    await poller.tick(); // getTask lanza -> advance captura
    const g = repo.getGeneration(row.id)!;
    expect(g.status).toBe("failed");
    expect(g.error).toContain("unknown task");
  });
});
