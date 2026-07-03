import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * Escena "estudio" compartida por el visor grande y el generador de thumbnails:
 * fondo transparente, luz tipo softbox, el modelo centrado y encuadrado.
 */
export function createStudioScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 5, 4);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 1.1);
  fill.position.set(-4, 2, -2);
  const rim = new THREE.DirectionalLight(0xd8c6ff, 1.4);
  rim.position.set(0, 3, -5);
  scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.55));
  return scene;
}

/** Centra el objeto en el origen y lo escala a ~1 unidad de radio. */
export function normalizeObject(obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  obj.position.sub(center);
  obj.scale.multiplyScalar(2 / maxDim);
}

const loader = new GLTFLoader();
// Los GLBs persistidos vienen comprimidos con EXT_meshopt_compression.
loader.setMeshoptDecoder(MeshoptDecoder);

/**
 * Entorno de iluminación PBR (RoomEnvironment): materiales metálicos/rugosos
 * se ven como en un estudio real. Se genera una vez por renderer.
 */
const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
export function applyStudioEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene
): void {
  let env = envCache.get(renderer);
  if (!env) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    envCache.set(renderer, env);
    pmrem.dispose();
  }
  scene.environment = env;
}

/** Sombra de contacto suave bajo el modelo (textura radial, sin luces extra). */
export function createContactShadow(): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.42)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.16)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.04;
  return mesh;
}

export function loadGlb(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        // Los GLB con COLOR_0 necesitan vertexColors activado.
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const mat = o.material as THREE.MeshStandardMaterial;
            if (o.geometry.getAttribute("color")) mat.vertexColors = true;
          }
        });
        resolve(gltf.scene);
      },
      undefined,
      reject
    );
  });
}

export { THREE, OrbitControls };
