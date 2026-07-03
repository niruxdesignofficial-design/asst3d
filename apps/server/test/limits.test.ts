import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/index.js";
import { Repo } from "../src/db/repo.js";
import { UsageControl, type LimitsConfig } from "../src/limits.js";
import type { MeshyClient, MeshyTask } from "../src/meshy/types.js";

class FakeMeshy implements MeshyClient {
  readonly twoStage = true;
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

  beforeEach(async () => {
    repo = new Repo(await openDb(":memory:"));
    meshy = new FakeMeshy();
  });

  it("permite generar a un usuario nuevo y descuenta el límite gratis", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    const user = await repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBeNull();
    expect(usage.freeRemaining(user)).toBe(3);
    await usage.consume(user, "1.1.1.1", "gen-1");
    expect(usage.freeRemaining((await repo.getUser("device-1"))!)).toBe(2);
  });

  it("bloquea con free_limit_reached al agotar lo gratis", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    await repo.upsertUser("device-1", "1.1.1.1");
    for (let i = 0; i < 3; i++) {
      expect(await usage.checkGenerate((await repo.getUser("device-1"))!, "1.1.1.1")).toBeNull();
      await usage.consume((await repo.getUser("device-1"))!, "1.1.1.1", `gen-${i}`);
    }
    const user = (await repo.getUser("device-1"))!;
    expect(usage.freeRemaining(user)).toBe(0);
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBe("free_limit_reached");
  });

  it("usuario con acceso por token no tiene límite gratis", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    await repo.upsertUser("device-1", null);
    // simular acceso pago
    await repo.db.run(
      `UPDATE users SET token_access = 1, generations_used = 99 WHERE id = 'device-1'`
    );
    const user = (await repo.getUser("device-1"))!;
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBeNull();
  });

  it("bloquea con capacity_reached al llegar al tope global mensual", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ globalMonthlyCap: 2, rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    await repo.incrementMonthly();
    await repo.incrementMonthly();
    const user = await repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBe("capacity_reached");
  });

  it("frena si el balance real de Meshy está por debajo del mínimo (modo no-mock)", async () => {
    meshy.balance = 5;
    const usage = new UsageControl(repo, meshy, cfg({ meshyMock: false, rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    const user = await repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBe("capacity_reached");
  });

  it("frena si no puede verificar el balance (mejor no gastar a ciegas)", async () => {
    meshy.getBalance = async () => {
      throw new Error("network down");
    };
    const usage = new UsageControl(repo, meshy, cfg({ meshyMock: false, rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    const user = await repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBe("capacity_reached");
  });

  it("aplica rate-limit por device dentro de la ventana", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 2, rateLimitPerHour: 100 }));
    const user = await repo.upsertUser("device-1", "1.1.1.1");
    expect(await usage.checkGenerate(user, null)).toBeNull();
    expect(await usage.checkGenerate(user, null)).toBeNull();
    expect(await usage.checkGenerate(user, null)).toBe("rate_limited");
  });

  it("un código promo suma generaciones y solo se canjea una vez", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 100, rateLimitPerHour: 100 }));
    let user = await repo.upsertUser("device-1", "1.1.1.1");
    // agotar las 3 gratis base
    for (let i = 0; i < 3; i++)
      await usage.consume((await repo.getUser("device-1"))!, "1.1.1.1", `g${i}`);
    user = (await repo.getUser("device-1"))!;
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBe("free_limit_reached");

    // canje FREE3 => +3
    expect(await repo.redeemCode(user.id, "FREE3", 3)).toBe(true);
    user = (await repo.getUser("device-1"))!;
    expect(usage.freeAllowance(user)).toBe(6);
    expect(usage.freeRemaining(user)).toBe(3);
    expect(await usage.checkGenerate(user, "1.1.1.1")).toBeNull();

    // segundo canje del mismo código: rechazado, sin duplicar bonus
    expect(await repo.redeemCode(user.id, "FREE3", 3)).toBe(false);
    expect(usage.freeAllowance((await repo.getUser("device-1"))!)).toBe(6);
  });

  it("el refund devuelve un uso sin ir por debajo de cero", async () => {
    await repo.upsertUser("device-1", null);
    await repo.refundUsage("device-1"); // en cero: queda en cero
    expect((await repo.getUser("device-1"))!.generations_used).toBe(0);
    await repo.incrementUsage("device-1", null, "g1");
    await repo.refundUsage("device-1");
    expect((await repo.getUser("device-1"))!.generations_used).toBe(0);
  });

  it("aplica rate-limit por IP aunque cambie el device", async () => {
    const usage = new UsageControl(repo, meshy, cfg({ rateLimitPerMinute: 2, rateLimitPerHour: 100 }));
    const ip = "9.9.9.9";
    expect(await usage.checkGenerate(await repo.upsertUser("d1", ip), ip)).toBeNull();
    expect(await usage.checkGenerate(await repo.upsertUser("d2", ip), ip)).toBeNull();
    expect(await usage.checkGenerate(await repo.upsertUser("d3", ip), ip)).toBe("rate_limited");
  });
});
