import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compressGlb } from "../src/compress.js";

const samples = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/samples"
);

describe("compressGlb", () => {
  it("comprime un GLB real: mucho más chico y sigue siendo un GLB válido", async () => {
    const input = fs.readFileSync(path.join(samples, "CesiumMilkTruck.glb"));
    const r = await compressGlb(input);
    expect(r.compressed).toBe(true);
    expect(r.outputBytes).toBeLessThan(r.inputBytes);
    // magia glTF intacta
    expect(r.data.subarray(0, 4).toString()).toBe("glTF");
    // la extensión de meshopt quedó declarada en el JSON del GLB
    const jsonLen = r.data.readUInt32LE(12);
    const json = r.data.subarray(20, 20 + jsonLen).toString();
    expect(json).toContain("EXT_meshopt_compression");
  }, 60_000);

  it("con basura no explota: devuelve el buffer original (fallback)", async () => {
    const junk = Buffer.from("esto no es un glb para nada");
    const r = await compressGlb(junk);
    expect(r.compressed).toBe(false);
    expect(r.data.equals(junk)).toBe(true);
  });
});
