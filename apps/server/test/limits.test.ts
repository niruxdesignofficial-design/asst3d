import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/index.js";
import { Repo } from "../src/db/repo.js";
import { UsageControl, type LimitsConfig } from "../src/limits.js";
import type { MeshyClient, MeshyTask } from "../src/meshy/types.js";

class FakeMeshy implements MeshyClient {
  balance = 1000;
  tasks = new Map<string, MeshyTask>();
  private seq = 0;

  async createTextPreview(): Promise<string> {
    const id = `t${++this.seq}`;
    this.tasks.set(id, { id, status: "PENDING", progress: 0 });
    return id;
  }
  async createTextRefine(): Promise<string> {
    const id = `r${++this.seq}`;
    this.tasks.set(id, { id, status: "PENDING", progress: 0 });
    return id;
  }
  async createImageTo3D(): Promise<string> {
    const id = `i${++this.seq}`;
    this.tasks.set(id, { id, status: "PENDING", progress: 0 });
    return id;
  }
  async getTask(taskId: string): Promise<MeshyTask> {
    return this.tasks.get(taskId)!;
  }
  async getBalance(): Promise<number> {
    return this.balance;
  }
}

const cfg = (over: Partial<LimitsConfig> = {}): LimitsConfig => ({
  freeGenerationsPerUser: 3,
  globalMonthlyCap: 10,
  meshyMinBalance: 20,
  rateLimitPerMinute: 3,
  rateLimitPerHour: 6,
  meshyMock: true,
  ...over,
});

describe("UsageControl (server-authoritative)", () => {
  let repo: Repo;
  let meshy: FakeMeshy;

  beforeEach(() => {
    repo = new Repo(openDb(":memory:"));
    meshy = new FakeMeshy();
  });

  it("permite generar a un usuario nuevo y descuenta el límite gratis", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    const user = repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBeNull();
    expect(usage.freeRemaining(user)).toBe(3);
    usage.consume(user, "1.1.1.1", "gen-1");
    expect(usage.freeRemaining(repo.getUser("device-1")!)).toBe(2);
  });

  it("bloquea con free_limit_reached al agotar lo gratis", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    let user = repo.upsertUser("device-1", "1.1.1.1");
    for (let i = 0; i < 3; i++) {
      expect(await usage.checkGenerate(repo.getUser("device-1")!, "1.1.1.1")).toBeNull();
      usage.consume(repo.getUser("device-1")!, "1.1.1.1", `gen-${i}`);
    }
    user = repo.getUser("device-1")!;
    expect(usage.freeRemaining(user)).toBe(0);
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBe("free_limit_reached");
  });

  it("usuario con acceso por token no tiene límite gratis", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    repo.upsertUser("device-1", null);
    // simular acceso pago
    (repo as unknown as { db: import("better-sqlite3").Database }).db
      .prepare(`UPDATE users SET token_access = 1, generations_used = 99 WHERE id = 'device-1'`)
      .run();
    const user = repo.getUser("device-1")!;
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBeNull();
  });

  it("bloquea con capacity_reached al llegar al tope global mensual", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ globalMonthlyCap: 2, rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    repo.incrementMonthly();
    repo.incrementMonthly();
    const user = repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBe("capacity_reached");
  });

  it("frena si el balance real de Meshy está por debajo del mínimo (modo no-mock)", async () => {
    meshy.balance = 5;
    const usage = new UsageControl(repo, meshy, cfg({ meshyMock: false, rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    const user = repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBe("capacity_reached");
  });

  it("frena si no puede verificar el balance (mejor no gastar a ciegas)", async () => {
    meshy.getBalance = async () => {
      throw new Error("network down");
    };
    const usage = new UsageControl(repo, meshy, cfg({ meshyMock: false, rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    const user = repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBe("capacity_reached");
  });

  it("aplica rate-limit por device dentro de la ventana", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 2, rateLimitPerHour: 100 }));
    const user = repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, null)).toBeNull();
    expect(await usage.checkGenerate(user, null)).toBeNull();
    expect(await usage.checkGenerate(user, null)).toBe("rate_limited");
  });

  it("aplica rate-limit por IP aunque cambie el device", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 2, rateLimitPerHour: 100 }));
    const ip = "9.9.9.9";
    expect(await usage.checkGenerate(repo.upsertUser("d1", ip), ip)).toBeNull();
    expect(await usage.checkGenerate(repo.upsertUser("d2", ip), ip)).toBeNull();
    expect(await usage.checkGenerate(repo.upsertUser("d3", ip), ip)).toBe("rate_limited");
  });
});
