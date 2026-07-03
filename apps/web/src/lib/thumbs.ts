import { createStudioScene, loadGlb, normalizeObject, THREE } from "./three-scene";

/**
 * Genera thumbnails de GLBs en el cliente con un único renderer offscreen.
 * (El server no puede renderizar sin GPU; para modelos reales Meshy manda
 * su propio thumbnail — esto cubre mock/seeds.)
 */
const SIZE = 384;
const memCache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let queue: Promise<void> = Promise.resolve();

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
  }
  return renderer;
}

/** GLBs enormes congelan el main thread al parsear: mejor placeholder que freeze. */
const MAX_THUMB_GLB_BYTES = 15 * 1024 * 1024;

async function renderOnce(url: string): Promise<string> {
  const cacheKey = `asst3d_thumb:${url}`;
  const stored = localStorage.getItem(cacheKey);
  if (stored) return stored;

  try {
    const head = await fetch(url, { method: "HEAD" });
    const len = Number(head.headers.get("content-length") ?? 0);
    if (len > MAX_THUMB_GLB_BYTES) throw new Error("glb too large for client thumbnail");
  } catch (err) {
    if (String(err).includes("too large")) throw err;
    /* HEAD no soportado: seguimos e intentamos igual */
  }

  const scene = createStudioScene();
  const model = await loadGlb(url);
  normalizeObject(model);
  model.rotation.y = Math.PI / 7;
  scene.add(model);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(1.9, 1.4, 2.6);
  camera.lookAt(0, 0, 0);

  const r = getRenderer();
  r.render(scene, camera);
  const dataUri = r.domElement.toDataURL("image/webp", 0.82);

  // Liberar recursos del modelo
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });

  try {
    localStorage.setItem(cacheKey, dataUri);
  } catch {
    /* localStorage lleno: seguimos solo con cache en memoria */
  }
  return dataUri;
}

/** Serializado en cola: un render por vez para no reventar WebGL contexts. */
export function thumbnailFor(url: string): Promise<string> {
  const hit = memCache.get(url);
  if (hit) return Promise.resolve(hit);
  const p = queue.then(async () => {
    const data = await renderOnce(url);
    memCache.set(url, data);
    return data;
  });
  queue = p.then(
    () => undefined,
    () => undefined
  );
  return p;
}
