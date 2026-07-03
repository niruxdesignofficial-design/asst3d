import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

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
