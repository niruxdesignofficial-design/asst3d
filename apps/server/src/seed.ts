import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { Repo } from "./db/repo.js";

/**
 * Seeds the Discover gallery with sample generations (only when empty)
 * so the home never starts deserted. Uses the real GLB assets committed
 * in assets/samples (Khronos glTF Sample Assets — see CREDITS.md).
 */

interface SeedInfo {
  title: string;
  styleId: string;
  author: string;
  kind: "text" | "image";
}

const SEEDS: Record<string, SeedInfo> = {
  "Lantern.glb": {
    title: "Victorian street lantern",
    styleId: "realistic",
    author: "polyforge",
    kind: "text",
  },
  "WaterBottle.glb": {
    title: "Sci-fi water bottle prop",
    styleId: "realistic",
    author: "gameprops.io",
    kind: "text",
  },
  "Avocado.glb": {
    title: "Photoreal avocado (food prop)",
    styleId: "realistic",
    author: "scanlab",
    kind: "image",
  },
  "BoomBox.glb": {
    title: "Retro boombox — 80s loot item",
    styleId: "realistic",
    author: "voxelsmith",
    kind: "text",
  },
  "Corset.glb": {
    title: "Leather corset — character wearable",
    styleId: "realistic",
    author: "wardrobe3d",
    kind: "image",
  },
  "ToyCar.glb": {
    title: "Die-cast toy race car",
    styleId: "stylized",
    author: "voxelsmith",
    kind: "text",
  },
  "Fox.glb": {
    title: "Animated low-poly fox",
    styleId: "lowpoly",
    author: "polyforge",
    kind: "text",
  },
  "CesiumMilkTruck.glb": {
    title: "Cartoon milk truck — vehicle asset",
    styleId: "stylized",
    author: "gameprops.io",
    kind: "text",
  },
  "MaterialsVariantsShoe.glb": {
    title: "Concept sneaker with material variants",
    styleId: "realistic",
    author: "scanlab",
    kind: "image",
  },
  "SheenChair.glb": {
    title: "Velvet lounge chair — interior prop",
    styleId: "realistic",
    author: "wardrobe3d",
    kind: "text",
  },
};

const SEED_COMMENTS = [
  "great topology, dropped it straight into Unity",
  "wow, this looks amazing",
  "the textures on this one are so clean",
  "using this in my game jam entry, thanks!",
];

export async function seedDiscover(repo: Repo): Promise<void> {
  if ((await repo.listPublic(1)).length > 0) return;
  if (!fs.existsSync(config.samplesDir)) return;
  const samples = fs.readdirSync(config.samplesDir).filter((f) => f.endsWith(".glb"));
  if (samples.length === 0) return;

  // Demo authors so the gallery feels alive.
  const authors = new Map<string, string>();
  for (const info of Object.values(SEEDS)) {
    if (!authors.has(info.author)) {
      const id = `seed-${info.author}`;
      await repo.upsertUser(id, null);
      await repo.setDisplayName(id, info.author);
      authors.set(info.author, id);
    }
  }
  const fallbackAuthor = authors.values().next().value ?? "seed-demo-user";

  let i = 0;
  for (const file of samples) {
    const info = SEEDS[file];
    const row = await repo.createGeneration({
      userId: info ? authors.get(info.author)! : fallbackAuthor,
      kind: info?.kind ?? "text",
      prompt: info?.title ?? file.replace(".glb", ""),
      styleId: info?.styleId ?? "realistic",
      modelType: info?.styleId === "lowpoly" ? "lowpoly" : "standard",
      isPublic: true,
    });
    const url = `sample://${file}`;
    await repo.updateGeneration(row.id, {
      status: "done",
      progress: 100,
      meshy_task_id: `seed-${randomUUID()}`,
      model_urls: JSON.stringify({ glb: url, fbx: url, obj: url, usdz: url }),
      likes: Math.floor(Math.random() * 900) + 40,
    });
    // A couple of seeded comments spread across models
    if (i < SEED_COMMENTS.length) {
      await repo.addComment(row.id, fallbackAuthor, SEED_COMMENTS[i]);
    }
    i++;
  }
}
