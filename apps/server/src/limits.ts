import type { Repo, UserRow } from "./db/repo.js";
import type { MeshyClient } from "./meshy/types.js";

export interface LimitsConfig {
  freeGenerationsPerUser: number;
  globalMonthlyCap: number;
  meshyMinBalance: number;
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  meshyMock: boolean;
}

export type DenyReason =
  | "rate_limited"
  | "free_limit_reached"
  | "capacity_reached"
  | null;

/**
 * Toda la decisión de "¿puede generar?" vive acá, en el server.
 * El cliente solo muestra el resultado.
 */
export class UsageControl {
  private events = new Map<string, number[]>(); // key -> timestamps de requests

  constructor(
    private repo: Repo,
    private meshy: MeshyClient,
    private cfg: LimitsConfig
  ) {}

  /** Sliding window en memoria por clave (ip o device). */
  private rateOk(key: string, now = Date.now()): boolean {
    const windowHour = 60 * 60 * 1000;
    const list = (this.events.get(key) ?? []).filter((t) => now - t < windowHour);
    const lastMinute = list.filter((t) => now - t < 60 * 1000);
    if (lastMinute.length >= this.cfg.rateLimitPerMinute) return false;
    if (list.length >= this.cfg.rateLimitPerHour) return false;
    list.push(now);
    this.events.set(key, list);
    return true;
  }

  /** true si el usuario tiene acceso pago (wallet con token verificado). */
  private hasTokenAccess(user: UserRow): boolean {
    return user.token_access === 1;
  }

  /** Total gratis del usuario: base + bonus por códigos promo canjeados. */
  freeAllowance(user: UserRow): number {
    return this.cfg.freeGenerationsPerUser + (user.bonus_generations ?? 0);
  }

  freeRemaining(user: UserRow): number {
    return Math.max(0, this.freeAllowance(user) - user.generations_used);
  }

  /** Rate-limit para intentos de canje de códigos (anti fuerza bruta). */
  codeAttemptOk(deviceId: string, ip: string | null): boolean {
    if (!this.rateOk(`code:d:${deviceId}`)) return false;
    if (ip && !this.rateOk(`code:ip:${ip}`)) return false;
    return true;
  }

  /** Capacidad global: contador propio + balance real de Meshy. */
  async capacityOk(): Promise<boolean> {
    if (this.repo.getMonthlyCount() >= this.cfg.globalMonthlyCap) return false;
    if (!this.cfg.meshyMock) {
      try {
        const balance = await this.meshy.getBalance();
        if (balance < this.cfg.meshyMinBalance) return false;
      } catch {
        // Si no podemos verificar el balance, frenamos: mejor no gastar a ciegas.
        return false;
      }
    }
    return true;
  }

  /** Chequeo completo antes de crear un job. Devuelve el motivo del rechazo o null. */
  async checkGenerate(user: UserRow, ip: string | null): Promise<DenyReason> {
    if (!this.rateOk(`d:${user.id}`)) return "rate_limited";
    if (ip && !this.rateOk(`ip:${ip}`)) return "rate_limited";
    if (!(await this.capacityOk())) return "capacity_reached";
    if (!this.hasTokenAccess(user) && this.freeRemaining(user) <= 0)
      return "free_limit_reached";
    return null;
  }

  /** Registra el consumo (se llama recién cuando el job fue aceptado). */
  consume(user: UserRow, ip: string | null, generationId: string): void {
    this.repo.incrementUsage(user.id, ip, generationId);
    this.repo.incrementMonthly();
  }
}
