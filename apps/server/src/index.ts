import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { Repo } from "./db/repo.js";
import { RealMeshyClient } from "./meshy/client.js";
import { MockMeshyClient } from "./meshy/mock.js";
import { UsageControl } from "./limits.js";
import { JobPoller } from "./poller.js";
import { registerRoutes } from "./routes.js";
import { seedDiscover } from "./seed.js";

const app = Fastify({
  logger: { level: "info" },
  bodyLimit: 30 * 1024 * 1024, // margen para imágenes base64 de hasta 20MB
});

const db = openDb();
const repo = new Repo(db);
const meshy = config.meshyMock ? new MockMeshyClient() : new RealMeshyClient();
const usage = new UsageControl(repo, meshy, config);
const poller = new JobPoller(repo, meshy, config.meshyMock ? 1000 : 3000);

seedDiscover(repo);
registerRoutes(app, { repo, meshy, usage });
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
      `ASST 3D server en http://127.0.0.1:${config.port} (meshy=${config.meshyMock ? "MOCK" : "REAL"})`
    );
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
