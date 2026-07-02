import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GenerationDto, MeDto } from "@asst3d/shared";
import { likeGeneration, listDiscover } from "../lib/api";
import { GeneratePanel } from "../components/GeneratePanel";
import { GenerationCard } from "../components/GenerationCard";
import { ModelModal } from "../components/ModelModal";
import { UsageGate } from "../components/UsageGate";

interface Props {
  me: MeDto | null;
  refreshMe: () => void;
}

const FILTERS = ["Recomendado", "Destacado", "Reciente"] as const;

export function Home({ me, refreshMe }: Props) {
  const [items, setItems] = useState<GenerationDto[]>([]);
  const [selected, setSelected] = useState<GenerationDto | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Recomendado");
  const navigate = useNavigate();

  useEffect(() => {
    listDiscover().then(setItems).catch(() => {});
  }, []);

  const sorted = [...items].sort((a, b) =>
    filter === "Destacado" ? b.likes - a.likes : b.createdAt - a.createdAt
  );

  return (
    <main>
      <section className="hero">
        <h1>
          ¡Hola! <span className="accent">¿Qué crearás en 3D?</span>
        </h1>
        <p className="muted">
          Describí un personaje, objeto o prop y lo convertimos en un modelo listo para tu juego.
        </p>
        <div className="hero-box">
          <GeneratePanel
            compact
            onStarted={(gen) => {
              refreshMe();
              navigate("/workspace", { state: { focusId: gen.id } });
            }}
            onDenied={setGate}
          />
        </div>
      </section>

      <section className="discover">
        <div className="discover-head">
          <h2>Más inspiración</h2>
          <div className="filter-tabs">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={filter === f ? "tab-on" : ""}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="grid">
          {sorted.map((g) => (
            <GenerationCard
              key={g.id}
              gen={g}
              onOpen={setSelected}
              onLike={(gen) => {
                likeGeneration(gen.id)
                  .then(({ likes }) =>
                    setItems((prev) =>
                      prev.map((it) => (it.id === gen.id ? { ...it, likes } : it))
                    )
                  )
                  .catch(() => {});
              }}
            />
          ))}
          {sorted.length === 0 && (
            <p className="muted">Todavía no hay modelos públicos. ¡Sé el primero en crear uno!</p>
          )}
        </div>
      </section>

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
