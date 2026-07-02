import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { GenerationDto, MeDto } from "@asst3d/shared";
import { getGeneration, listMine, uploadThumbnail } from "../lib/api";
import { GeneratePanel } from "../components/GeneratePanel";
import { GenerationCard } from "../components/GenerationCard";
import { ModelModal } from "../components/ModelModal";
import { ModelViewer } from "../components/ModelViewer";
import { UsageGate } from "../components/UsageGate";

interface Props {
  me: MeDto | null;
  refreshMe: () => void;
}

/** Workspace de 3 paneles: opciones | resultado | historial (como Meshy). */
export function Workspace({ me, refreshMe }: Props) {
  const [mine, setMine] = useState<GenerationDto[]>([]);
  const [current, setCurrent] = useState<GenerationDto | null>(null);
  const [selected, setSelected] = useState<GenerationDto | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const pollRef = useRef<number | null>(null);
  const location = useLocation() as { state?: { focusId?: string } };

  const refreshMine = useCallback(() => {
    listMine().then(setMine).catch(() => {});
  }, []);

  useEffect(refreshMine, [refreshMine]);

  // Si venimos de la home con una generación recién lanzada, seguirla acá.
  useEffect(() => {
    const focusId = location.state?.focusId;
    if (focusId) getGeneration(focusId).then(setCurrent).catch(() => {});
  }, [location.state?.focusId]);

  // Polling del job activo contra NUESTRO server (nunca contra Meshy).
  useEffect(() => {
    if (!current || current.status === "done" || current.status === "failed") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const g = await getGeneration(current.id);
        setCurrent(g);
        if (g.status === "done" || g.status === "failed") {
          refreshMine();
          refreshMe();
        }
      } catch {
        /* reintento en el próximo tick */
      }
    }, 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [current, refreshMine, refreshMe]);

  const filtered = mine.filter(
    (g) => !search || (g.prompt ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="ws">
      <aside className="ws-left">
        <h2 className="ws-heading">Crear</h2>
        <GeneratePanel
          onStarted={(gen) => {
            setCurrent(gen);
            refreshMine();
            refreshMe();
          }}
          onDenied={setGate}
        />
        {me && (
          <p className="muted small ws-quota">
            {me.hasTokenAccess
              ? "Acceso con token: generaciones ilimitadas"
              : `Te quedan ${me.freeRemaining} de ${me.freeLimit} generaciones gratis`}
          </p>
        )}
      </aside>

      <section className="ws-center">
        {!current && (
          <div className="ws-empty">
            <div className="ws-empty-mark">◆ ▲ ●</div>
            <h2>¿Qué crearás hoy?</h2>
            <p className="muted">
              Generá un modelo desde texto o imagen. Lo vas a poder rotar, inspeccionar y
              descargar listo para tu motor de juego.
            </p>
          </div>
        )}

        {current && (current.status === "pending" || current.status === "processing") && (
          <div className="ws-progress">
            <h3>Generando “{current.prompt ?? "tu modelo"}”…</h3>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${current.progress}%` }} />
            </div>
            <p className="muted small">
              {current.progress < 50 ? "Construyendo geometría" : "Aplicando texturas"} ·{" "}
              {current.progress}%
            </p>
          </div>
        )}

        {current?.status === "failed" && (
          <div className="ws-progress">
            <h3>La generación falló</h3>
            <p className="form-error">{current.error ?? "Error desconocido"}</p>
          </div>
        )}

        {current?.status === "done" && current.viewerUrl && (
          <div className="ws-result">
            <ModelViewer
              src={current.viewerUrl}
              onSnapshot={
                current.thumbnailUrl
                  ? undefined
                  : (uri) => uploadThumbnail(current.id, uri).catch(() => {})
              }
            />
            <div className="ws-result-bar">
              <strong>{current.prompt ?? "Modelo"}</strong>
              <button className="btn-secondary" onClick={() => setSelected(current)}>
                Detalles y descarga
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="ws-right">
        <div className="ws-right-head">
          <h2 className="ws-heading">Mis generaciones</h2>
          <input
            className="search"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="ws-history">
          {filtered.map((g) => (
            <GenerationCard
              key={g.id}
              gen={g}
              onOpen={(gen) => (gen.status === "done" ? setSelected(gen) : setCurrent(gen))}
            />
          ))}
          {filtered.length === 0 && (
            <p className="muted small">Acá va a aparecer tu historial para volver a descargar.</p>
          )}
        </div>
      </aside>

      {selected && <ModelModal gen={selected} onClose={() => setSelected(null)} />}
      {gate && (
        <UsageGate
          code={gate}
          paymentsEnabled={me?.paymentsEnabled ?? false}
          onDismiss={() => setGate(null)}
        />
      )}
    </main>
  );
}
