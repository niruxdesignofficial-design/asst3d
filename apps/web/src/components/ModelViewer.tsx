import { useEffect, useRef, useState } from "react";
import {
  applyStudioEnvironment,
  createContactShadow,
  createStudioScene,
  loadGlb,
  normalizeObject,
  OrbitControls,
  THREE,
} from "../lib/three-scene";

export interface MeshStats {
  triangles: number;
  vertices: number;
  meshes: number;
}

interface Props {
  src: string;
  autoRotate?: boolean;
  /** callback with a webp snapshot once loaded (to upload as thumbnail) */
  onSnapshot?: (dataUri: string) => void;
  /** callback with mesh stats (triangles/vertices) once loaded */
  onStats?: (stats: MeshStats) => void;
  /** show the topology stats panel (like a real inspector) */
  showStats?: boolean;
}

function computeStats(root: THREE.Object3D): MeshStats {
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++;
      const g = o.geometry as THREE.BufferGeometry;
      const pos = g.getAttribute("position");
      if (pos) {
        vertices += pos.count;
        triangles += g.index ? g.index.count / 3 : pos.count / 3;
      }
    }
  });
  return { triangles: Math.round(triangles), vertices, meshes };
}

/** Interactive 3D viewer: orbit (drag), zoom (wheel), pan (right-click). */
export function ModelViewer({ src, autoRotate = true, onSnapshot, onStats, showStats = false }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [wireframe, setWireframe] = useState(false);
  const [spin, setSpin] = useState(autoRotate);
  const [lightBg, setLightBg] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<MeshStats | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const controlsRef = useRef<InstanceType<typeof OrbitControls> | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  const snapshot = () => {
    const r = rendererRef.current;
    if (!r) return;
    const a = document.createElement("a");
    a.href = r.domElement.toDataURL("image/png");
    a.download = "formora-model.png";
    a.click();
  };

  const fullscreen = () => {
    const el = mountRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);

    rendererRef.current = renderer;
    const scene = createStudioScene();
    sceneRef.current = scene;
    // Iluminación por entorno: los materiales PBR se ven nivel estudio.
    applyStudioEnvironment(renderer, scene);
    scene.add(createContactShadow());
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(2.2, 1.6, 3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.6;
    controls.minDistance = 1.2;
    controls.maxDistance = 12;
    controlsRef.current = controls;

    // Subtle reference floor
    const grid = new THREE.GridHelper(8, 16, 0x4c3a6e, 0x241b38);
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
    setStats(null);
    loadGlb(src)
      .then((model) => {
        if (disposed) return;
        normalizeObject(model);
        scene.add(model);
        modelRef.current = model;
        setLoading(false);
        const s = computeStats(model);
        setStats(s);
        onStats?.(s);
        if (onSnapshot) {
          renderer.render(scene, camera);
          onSnapshot(renderer.domElement.toDataURL("image/webp", 0.82));
        }
      })
      .catch(() => {
        if (!disposed) {
          setLoading(false);
          setError("Could not load this model");
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
  }, [src, autoRotate, onSnapshot, onStats]);

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

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = spin;
  }, [spin]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.background = lightBg ? new THREE.Color(0xe8e6ef) : null;
  }, [lightBg, loading]);

  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <div className="viewer">
      <div ref={mountRef} className="viewer-canvas" />
      {loading && <div className="viewer-overlay">Loading model…</div>}
      {error && <div className="viewer-overlay viewer-error">{error}</div>}

      {showStats && stats && !loading && (
        <div className="viewer-stats">
          <div>
            <span>Topology</span>
            <strong>Tris</strong>
          </div>
          <div>
            <span>Faces</span>
            <strong>{fmt(stats.triangles)}</strong>
          </div>
          <div>
            <span>Vertices</span>
            <strong>{fmt(stats.vertices)}</strong>
          </div>
          <div>
            <span>Meshes</span>
            <strong>{fmt(stats.meshes)}</strong>
          </div>
        </div>
      )}

      <div className="viewer-toolbar">
        <div className="viewer-actions">
          <button
            className={`chip ${wireframe ? "chip-on" : ""}`}
            onClick={() => setWireframe((w) => !w)}
            title="Toggle wireframe"
          >
            Wireframe
          </button>
          <button
            className={`chip ${spin ? "chip-on" : ""}`}
            onClick={() => setSpin((s) => !s)}
            title="Toggle auto-rotate"
          >
            Spin
          </button>
          <button
            className={`chip ${lightBg ? "chip-on" : ""}`}
            onClick={() => setLightBg((v) => !v)}
            title="Toggle light background"
          >
            ◐
          </button>
          <button className="chip" onClick={snapshot} title="Save a PNG snapshot">
            📷
          </button>
          <button className="chip" onClick={fullscreen} title="Fullscreen">
            ⛶
          </button>
        </div>
        <span className="viewer-hint">Drag to orbit · scroll to zoom</span>
      </div>
    </div>
  );
}
