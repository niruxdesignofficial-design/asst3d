import { useEffect, useRef, useState } from "react";
import {
  createStudioScene,
  loadGlb,
  normalizeObject,
  OrbitControls,
  THREE,
} from "../lib/three-scene";

interface Props {
  src: string;
  autoRotate?: boolean;
  /** callback con un snapshot webp una vez cargado (para subir thumbnail) */
  onSnapshot?: (dataUri: string) => void;
}

/** Visor 3D interactivo: orbitar (drag), zoom (rueda), pan (click derecho). */
export function ModelViewer({ src, autoRotate = true, onSnapshot }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [wireframe, setWireframe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = createStudioScene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(2.2, 1.6, 3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.6;
    controls.minDistance = 1.2;
    controls.maxDistance = 12;

    // Piso sutil de referencia
    const grid = new THREE.GridHelper(8, 16, 0x2c3a2e, 0x1a231c);
    grid.position.y = -1.05;
    scene.add(grid);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let disposed = false;
    setLoading(true);
    setError(null);
    loadGlb(src)
      .then((model) => {
        if (disposed) return;
        normalizeObject(model);
        scene.add(model);
        modelRef.current = model;
        setLoading(false);
        if (onSnapshot) {
          renderer.render(scene, camera);
          onSnapshot(renderer.domElement.toDataURL("image/webp", 0.82));
        }
      })
      .catch(() => {
        if (!disposed) {
          setLoading(false);
          setError("No se pudo cargar el modelo");
        }
      });

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [src, autoRotate, onSnapshot]);

  useEffect(() => {
    modelRef.current?.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          (m as THREE.MeshStandardMaterial).wireframe = wireframe;
        });
      }
    });
  }, [wireframe]);

  return (
    <div className="viewer">
      <div ref={mountRef} className="viewer-canvas" />
      {loading && <div className="viewer-overlay">Cargando modelo…</div>}
      {error && <div className="viewer-overlay viewer-error">{error}</div>}
      <div className="viewer-toolbar">
        <button
          className={`chip ${wireframe ? "chip-on" : ""}`}
          onClick={() => setWireframe((w) => !w)}
          title="Ver malla"
        >
          Wireframe
        </button>
        <span className="viewer-hint">Arrastrá para girar · rueda para zoom</span>
      </div>
    </div>
  );
}
