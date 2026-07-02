import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carga .env de la raíz del repo (sin dependencia externa).
const envPath = path.resolve(__dirname, "../../../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function int(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

const meshyKey = process.env.MESHY_API_KEY?.trim() || "";

export const config = {
  port: int("PORT", 8787),
  dataDir: path.resolve(__dirname, "../data"),
  samplesDir: path.resolve(__dirname, "../assets/samples"),

  meshyApiKey: meshyKey,
  meshyBaseUrl: "https://api.meshy.ai",
  // Mock automático si no hay key: nunca rompe ni gasta créditos por accidente.
  meshyMock: process.env.MESHY_MOCK === "true" || meshyKey === "",

  freeGenerationsPerUser: int("FREE_GENERATIONS_PER_USER", 3),
  globalMonthlyCap: int("GLOBAL_MONTHLY_CAP", 200),
  meshyMinBalance: int("MESHY_MIN_BALANCE", 20),
  rateLimitPerMinute: int("RATE_LIMIT_MAX_PER_MINUTE", 3),
  rateLimitPerHour: int("RATE_LIMIT_MAX_PER_HOUR", 10),

  paymentsEnabled: process.env.PAYMENTS_ENABLED === "true",
  tokenGateAddress: process.env.TOKEN_GATE_ADDRESS?.trim() || "",
};

export type Config = typeof config;
