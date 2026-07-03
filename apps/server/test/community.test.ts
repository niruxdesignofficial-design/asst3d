import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/index.js";
import { Repo } from "../src/db/repo.js";
import { findBlockedTerm } from "../src/moderation.js";

describe("discover server-side (searchPublic)", () => {
  let repo: Repo;

  beforeEach(async () => {
    repo = new Repo(await openDb(":memory:"));
    await repo.upsertUser("u1", null);
    await repo.setDisplayName("u1", "polymaster");
    for (const [prompt, likes, ageDays] of [
      ["ancient stone golem", 100, 30],
      ["cyber dragon", 10, 0],
      ["wooden barrel", 0, 1],
    ] as const) {
      const row = await repo.createGeneration({
        userId: "u1", kind: "text", prompt, styleId: "lowpoly",
        modelType: "lowpoly", isPublic: true,
      });
      await repo.updateGeneration(row.id, {
        status: "done", progress: 100,
        model_urls: JSON.stringify({ glb: "sample://x.glb" }),
        likes,
      });
      await repo.db.run(`UPDATE generations SET created_at = ? WHERE id = ?`, [
        Date.now() - ageDays * 86400000, row.id,
      ]);
    }
  });

  it("top ordena por likes; recent por fecha", async () => {
    const top = await repo.searchPublic({ sort: "top" });
    expect(top[0].prompt).toBe("ancient stone golem");
    const recent = await repo.searchPublic({ sort: "recent" });
    expect(recent[0].prompt).toBe("cyber dragon");
  });

  it("trending favorece likes recientes sobre likes viejos", async () => {
    const trending = await repo.searchPublic({ sort: "trending" });
    // 10 likes de hoy pesan más que 100 de hace un mes
    expect(trending[0].prompt).toBe("cyber dragon");
  });

  it("busca por prompt y por autor", async () => {
    expect((await repo.searchPublic({ q: "golem" }))[0].prompt).toBe("ancient stone golem");
    expect((await repo.searchPublic({ q: "polymaster" })).length).toBe(3);
    expect((await repo.searchPublic({ q: "inexistente" })).length).toBe(0);
  });

  it("pagina de a pageSize", async () => {
    const p0 = await repo.searchPublic({ sort: "recent", page: 0, pageSize: 2 });
    const p1 = await repo.searchPublic({ sort: "recent", page: 1, pageSize: 2 });
    expect(p0.length).toBe(2);
    expect(p1.length).toBe(1);
    expect(p0.map((r) => r.id)).not.toContain(p1[0].id);
  });
});

describe("moderación", () => {
  it("bloquea términos de la lista y deja pasar prompts normales", () => {
    expect(findBlockedTerm("a cute nsfw character")).toBeTruthy();
    expect(findBlockedTerm("GORE zombie descuartizado")).toBeTruthy();
    expect(findBlockedTerm("a medieval wooden shield")).toBeNull();
  });

  it("los reports auto-despublican al llegar al umbral", async () => {
    const repo = new Repo(await openDb(":memory:"));
    await repo.upsertUser("u1", null);
    const row = await repo.createGeneration({
      userId: "u1", kind: "text", prompt: "x", styleId: "lowpoly",
      modelType: "lowpoly", isPublic: true,
    });
    for (let i = 0; i < 4; i++) await repo.reportGeneration(row.id, 5);
    expect((await repo.getGeneration(row.id))!.is_public).toBe(1);
    await repo.reportGeneration(row.id, 5);
    expect((await repo.getGeneration(row.id))!.is_public).toBe(0);
  });
});
