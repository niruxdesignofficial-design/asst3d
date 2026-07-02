import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { Repo } from "./db/repo.js";

/**
 * Puebla la galería Discover con generaciones de muestra (solo si está vacía)
 * para que la home no arranque desierta. Usa los GLBs locales de assets/samples.
 */
export function seedDiscover(repo: Repo): void {
  if (repo.listPublic(1).length > 0) return;
  if (!fs.existsSync(config.samplesDir)) return;
  const samples = fs.readdirSync(config.samplesDir).filter((f) => f.endsWith(".glb"));
  if (samples.length === 0) return;

  const demoUser = repo.upsertUser("seed-demo-user", null);
  const names: Record<string, string> = {
    "crystal.glb": "Cristal arcano",
    "robot.glb": "Robot centinela",
    "rock.glb": "Roca de cueva",
    "tree.glb": "Árbol low-poly",
    "barrel.glb": "Barril de campamento",
    "gem.glb": "Gema de botín",
    "tower.glb": "Torre de vigilancia",
    "mushroom.glb": "Hongo gigante",
  };

  for (const file of samples) {
    const row = repo.createGeneration({
      userId: demoUser.id,
      kind: "text",
      prompt: names[file] ?? file.replace(".glb", ""),
      styleId: "lowpoly",
      modelType: "lowpoly",
      isPublic: true,
    });
    const url = `sample://${file}`;
    repo.updateGeneration(row.id, {
      status: "done",
      progress: 100,
      meshy_task_id: `seed-${randomUUID()}`,
      model_urls: JSON.stringify({ glb: url, fbx: url, obj: url, usdz: url }),
      likes: Math.floor(Math.random() * 400) + 12,
    });
  }
}
