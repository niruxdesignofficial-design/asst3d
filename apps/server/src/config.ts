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
const threedaiKey = process.env.THREEDAI_API_KEY?.trim() || "";

// Proveedor de generación: explícito por env, o inferido por qué key hay cargada.
type Provider = "mock" | "meshy" | "3daistudio";
function resolveProvider(): Provider {
  const p = process.env.PROVIDER?.trim().toLowerCase();
  if (p === "mock" || p === "meshy" || p === "3daistudio") return p;
  if (threedaiKey) return "3daistudio";
  if (meshyKey) return "meshy";
  return "mock";
}
const provider = resolveProvider();

export const config = {
  port: int("PORT", 8787),
  // En Render/hosting: HOST=0.0.0.0 y DATA_DIR apuntando al disco persistente.
  host: process.env.HOST?.trim() || "127.0.0.1",
  dataDir: process.env.DATA_DIR?.trim() || path.resolve(__dirname, "../data"),
  samplesDir: path.resolve(__dirname, "../assets/samples"),
  // Build del frontend (apps/web/dist); si existe, el server lo sirve (deploy de un solo servicio).
  webDistDir: path.resolve(__dirname, "../../web/dist"),

  meshyApiKey: meshyKey,
  meshyBaseUrl: "https://api.meshy.ai",
  threedaiApiKey: threedaiKey,
  threedaiBaseUrl: "https://api.3daistudio.com",
  provider,
  // Mock si no hay ninguna key (o PROVIDER=mock / MESHY_MOCK=true legacy):
  // nunca rompe ni gasta créditos por accidente.
  meshyMock: provider === "mock" || process.env.MESHY_MOCK === "true",

  freeGenerationsPerUser: int("FREE_GENERATIONS_PER_USER", 3),
  globalMonthlyCap: int("GLOBAL_MONTHLY_CAP", 200),
  meshyMinBalance: int("MESHY_MIN_BALANCE", 20),
  rateLimitPerMinute: int("RATE_LIMIT_MAX_PER_MINUTE", 3),
  rateLimitPerHour: int("RATE_LIMIT_MAX_PER_HOUR", 10),

  paymentsEnabled: process.env.PAYMENTS_ENABLED === "true",
  tokenGateAddress: process.env.TOKEN_GATE_ADDRESS?.trim() || "",
};

export type Config = typeof config;
