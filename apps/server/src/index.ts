import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { Repo } from "./db/repo.js";
import { RealMeshyClient } from "./meshy/client.js";
import { MockMeshyClient } from "./meshy/mock.js";
import { ThreeDAIClient, ThreeDAIFastClient } from "./meshy/threedai.js";
import { StabilityFastClient } from "./meshy/stability.js";
import { persistModels } from "./persist.js";
import { initStorage } from "./storage.js";
import { UsageControl } from "./limits.js";
import { JobPoller } from "./poller.js";
import { registerRoutes } from "./routes.js";
import { seedDiscover } from "./seed.js";

const app = Fastify({
  logger: { level: "info" },
  bodyLimit: 30 * 1024 * 1024, // margen para imágenes base64 de hasta 20MB
});

const db = await openDb();
const repo = new Repo(db);
// Storage de modelos: R2 > blobs en la DB (Neon) > disco local.
initStorage(db);
const meshy =
  config.provider === "3daistudio"
    ? new ThreeDAIClient()
    : config.provider === "meshy"
      ? new RealMeshyClient()
      : new MockMeshyClient();
// Modo Fast: Stability (<20s, sync) si hay key; si no, 3D AI Studio (~1-4 min).
const fast = config.meshyMock
  ? undefined
  : config.stabilityApiKey
    ? new StabilityFastClient()
    : config.threedaiApiKey
      ? new ThreeDAIFastClient()
      : undefined;
const usage = new UsageControl(repo, meshy, config);
const poller = new JobPoller(
  repo,
  meshy,
  config.meshyMock ? 1000 : 4000,
  persistModels,
  fast ? { fast } : undefined
);

const fastProvider = !fast
  ? undefined
  : config.stabilityApiKey
    ? "stability"
    : "3daistudio";

await seedDiscover(repo);
registerRoutes(app, { repo, meshy, usage, fast, fastProvider });
poller.start();

// Deploy de un solo servicio: si existe el build del frontend, servirlo desde acá.
// (En dev no existe: Vite corre aparte en 5199 con proxy a /api.)
if (fs.existsSync(path.join(config.webDistDir, "index.html"))) {
  app.register(fastifyStatic, { root: config.webDistDir });
  // SPA fallback: cualquier ruta que no sea /api devuelve index.html (React Router resuelve).
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
    return reply.sendFile("index.html");
  });
  app.log.info(`Sirviendo frontend desde ${config.webDistDir}`);
}

app
  .listen({ port: config.port, host: config.host })
  .then(() => {
    app.log.info(
      `Formora server en http://${config.host}:${config.port} (meshy=${config.meshyMock ? "MOCK" : "REAL"})`
    );
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
