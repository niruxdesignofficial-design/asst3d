/**
 * Genera GLBs de muestra (low-poly, colores por vértice) para el modo mock.
 * Se corre una vez: pnpm --filter @asst3d/server gen:samples
 * Los archivos se commitean en assets/samples/ — no hay dependencia en runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const outDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/samples"
);
fs.mkdirSync(outDir, { recursive: true });

// ---------- helpers ----------

/** Prepara una geometría: sin uv, no-indexada (flat shading), color uniforme con jitter por cara. */
function paint(
  geo: THREE.BufferGeometry,
  color: string,
  jitter = 0.06
): THREE.BufferGeometry {
  const g = geo.toNonIndexed();
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  const base = new THREE.Color(color);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let face = 0; face < count / 3; face++) {
    const c = base.clone();
    const j = (Math.random() - 0.5) * 2 * jitter;
    c.offsetHSL(0, 0, j);
    for (let v = 0; v < 3; v++) {
      colors.set([c.r, c.g, c.b], (face * 3 + v) * 3);
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

function tf(
  geo: THREE.BufferGeometry,
  { p, r, s }: { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number }
): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const scale =
    typeof s === "number" ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...(s ?? [1, 1, 1]));
  m.compose(
    new THREE.Vector3(...(p ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r ?? [0, 0, 0]))),
    scale
  );
  geo.applyMatrix4(m);
  return geo;
}

/** Escribe una geometría (position/normal/color, no-indexada) como GLB binario. */
function writeGlb(geo: THREE.BufferGeometry, file: string): void {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const col = geo.getAttribute("color");
  const count = pos.count;

  const posBytes = Buffer.from(new Float32Array(pos.array).buffer);
  const norBytes = Buffer.from(new Float32Array(nor.array).buffer);
  const colBytes = Buffer.from(new Float32Array(col.array).buffer);
  const bin = Buffer.concat([posBytes, norBytes, colBytes]);

  geo.computeBoundingBox();
  const bb = geo.boundingBox!;

  const gltf = {
    asset: { version: "2.0", generator: "asst3d-sample-gen" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.05,
          roughnessFactor: 0.85,
        },
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length },
      { buffer: 0, byteOffset: posBytes.length, byteLength: norBytes.length },
      { buffer: 0, byteOffset: posBytes.length + norBytes.length, byteLength: colBytes.length },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count,
        type: "VEC3",
        min: [bb.min.x, bb.min.y, bb.min.z],
        max: [bb.max.x, bb.max.y, bb.max.z],
      },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count, type: "VEC3" },
    ],
  };

  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) json = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binPadded = binPad ? Buffer.concat([bin, Buffer.alloc(binPad)]) : bin;

  const total = 12 + 8 + json.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHdr = Buffer.alloc(8);
  jsonHdr.writeUInt32LE(json.length, 0);
  jsonHdr.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binHdr = Buffer.alloc(8);
  binHdr.writeUInt32LE(binPadded.length, 0);
  binHdr.writeUInt32LE(0x004e4942, 4); // 'BIN'

  fs.writeFileSync(
    path.join(outDir, file),
    Buffer.concat([header, jsonHdr, json, binHdr, binPadded])
  );
  console.log(`✓ ${file} (${count} vértices)`);
}

function jitterVerts(geo: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
  const p = geo.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(
      i,
      p.getX(i) + (Math.random() - 0.5) * amount,
      p.getY(i) + (Math.random() - 0.5) * amount,
      p.getZ(i) + (Math.random() - 0.5) * amount
    );
  }
  return geo;
}

// ---------- modelos ----------

function crystal(): THREE.BufferGeometry {
  const parts = [
    paint(tf(new THREE.IcosahedronGeometry(0.5, 0), { s: [0.6, 1.8, 0.6] }), "#9b5cf6", 0.1),
    paint(
      tf(new THREE.IcosahedronGeometry(0.3, 0), { p: [0.45, -0.4, 0.1], s: [0.5, 1.1, 0.5] }),
      "#7c3aed",
      0.1
    ),
    paint(
      tf(new THREE.IcosahedronGeometry(0.25, 0), { p: [-0.4, -0.5, -0.1], s: [0.5, 0.9, 0.5] }),
      "#c4b5fd",
      0.1
    ),
    paint(tf(new THREE.CylinderGeometry(0.7, 0.85, 0.25, 7), { p: [0, -0.95, 0] }), "#4c1d95"),
  ];
  return mergeGeometries(parts)!;
}

function robot(): THREE.BufferGeometry {
  const body = "#8da2b5";
  const dark = "#3f4c5c";
  const accent = "#59f2c1";
  const parts = [
    paint(tf(new THREE.BoxGeometry(0.9, 1.1, 0.6), { p: [0, 0, 0] }), body),
    paint(tf(new THREE.BoxGeometry(0.6, 0.5, 0.5), { p: [0, 0.95, 0] }), body),
    paint(tf(new THREE.BoxGeometry(0.34, 0.1, 0.05), { p: [0, 0.98, 0.26] }), accent, 0.02),
    paint(tf(new THREE.BoxGeometry(0.22, 0.75, 0.25), { p: [-0.62, 0.05, 0] }), dark),
    paint(tf(new THREE.BoxGeometry(0.22, 0.75, 0.25), { p: [0.62, 0.05, 0] }), dark),
    paint(tf(new THREE.BoxGeometry(0.3, 0.7, 0.32), { p: [-0.24, -0.95, 0] }), dark),
    paint(tf(new THREE.BoxGeometry(0.3, 0.7, 0.32), { p: [0.24, -0.95, 0] }), dark),
    paint(tf(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 5), { p: [0.18, 1.35, 0] }), dark),
    paint(tf(new THREE.IcosahedronGeometry(0.07, 0), { p: [0.18, 1.58, 0] }), accent, 0.02),
  ];
  return mergeGeometries(parts)!;
}

function rock(): THREE.BufferGeometry {
  const g = jitterVerts(new THREE.IcosahedronGeometry(1, 1), 0.25);
  return paint(tf(g, { s: [1.2, 0.8, 1] }), "#7d8590", 0.1);
}

function tree(): THREE.BufferGeometry {
  const parts = [
    paint(tf(new THREE.CylinderGeometry(0.16, 0.24, 0.9, 6), { p: [0, -0.9, 0] }), "#7c4a2d"),
    paint(tf(new THREE.ConeGeometry(0.85, 1.1, 7), { p: [0, -0.1, 0] }), "#2f8f4e", 0.09),
    paint(tf(new THREE.ConeGeometry(0.65, 0.95, 7), { p: [0, 0.55, 0] }), "#37a75c", 0.09),
    paint(tf(new THREE.ConeGeometry(0.42, 0.8, 7), { p: [0, 1.15, 0] }), "#43c06d", 0.09),
  ];
  return mergeGeometries(parts)!;
}

function barrel(): THREE.BufferGeometry {
  const parts = [
    paint(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12), "#9a6238", 0.08),
    paint(tf(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 12), { p: [0, 0.45, 0] }), "#4a4f57"),
    paint(tf(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 12), { p: [0, -0.45, 0] }), "#4a4f57"),
  ];
  return mergeGeometries(parts)!;
}

function gem(): THREE.BufferGeometry {
  const parts = [
    paint(tf(new THREE.OctahedronGeometry(0.8, 0), { s: [1, 1.25, 1] }), "#22d3ee", 0.12),
  ];
  return mergeGeometries(parts)!;
}

function tower(): THREE.BufferGeometry {
  const stone = "#8a8f98";
  const parts = [
    paint(new THREE.CylinderGeometry(0.55, 0.7, 2.2, 8), stone, 0.07),
    paint(tf(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 8), { p: [0, 1.25, 0] }), "#6b7078"),
    paint(tf(new THREE.ConeGeometry(0.8, 0.9, 8), { p: [0, 1.85, 0] }), "#b0483a", 0.06),
    paint(tf(new THREE.BoxGeometry(0.18, 0.3, 0.05), { p: [0, 0.4, 0.62] }), "#2c2f33"),
  ];
  return mergeGeometries(parts)!;
}

function mushroom(): THREE.BufferGeometry {
  const parts = [
    paint(tf(new THREE.CylinderGeometry(0.28, 0.38, 1, 8), { p: [0, -0.5, 0] }), "#e8dcc8"),
    paint(
      tf(new THREE.SphereGeometry(0.85, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), {
        p: [0, 0, 0],
        s: [1, 0.75, 1],
      }),
      "#d64545",
      0.05
    ),
    paint(tf(new THREE.IcosahedronGeometry(0.09, 0), { p: [0.35, 0.35, 0.3] }), "#f4efe6", 0.02),
    paint(tf(new THREE.IcosahedronGeometry(0.07, 0), { p: [-0.3, 0.42, -0.15] }), "#f4efe6", 0.02),
    paint(tf(new THREE.IcosahedronGeometry(0.08, 0), { p: [-0.1, 0.3, 0.5] }), "#f4efe6", 0.02),
  ];
  return mergeGeometries(parts)!;
}

// ---------- run ----------

const models: Record<string, () => THREE.BufferGeometry> = {
  "crystal.glb": crystal,
  "robot.glb": robot,
  "rock.glb": rock,
  "tree.glb": tree,
  "barrel.glb": barrel,
  "gem.glb": gem,
  "tower.glb": tower,
  "mushroom.glb": mushroom,
};

for (const [file, make] of Object.entries(models)) {
  writeGlb(make(), file);
}
console.log(`\nListo: ${Object.keys(models).length} muestras en ${outDir}`);
