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

/** 3-panel workspace: options | result | history. */
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

  // Coming from the home page with a freshly launched generation: track it here.
  useEffect(() => {
    const focusId = location.state?.focusId;
    if (focusId) getGeneration(focusId).then(setCurrent).catch(() => {});
  }, [location.state?.focusId]);

  // Poll the active job against OUR server (never Meshy directly).
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
        /* retry on next tick */
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
        <h2 className="ws-heading">Create</h2>
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
              ? "Token access: unlimited generations"
              : `${me.freeRemaining} of ${me.freeLimit} free generations left`}
          </p>
        )}
      </aside>

      <section className="ws-center">
        {!current && (
          <div className="ws-empty">
            <div className="ws-empty-mark">◆ ▲ ●</div>
            <h2>What will you create today?</h2>
            <p className="muted">
              Generate a model from text or an image. Preview it in 3D, inspect the topology and
              download it ready for your game engine.
            </p>
            <div className="ws-tip">
              <strong>Pro tip:</strong> the best prompts name the object, its material and its
              mood — “weathered bronze astronaut statue, moss-covered” beats “a statue”.
            </div>
          </div>
        )}

        {current && (current.status === "pending" || current.status === "processing") && (
          <div className="ws-progress">
            <h3>Generating “{current.prompt ?? "your model"}”…</h3>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${Math.max(4, current.progress)}%` }} />
            </div>
            <p className="muted small">{current.progress}% — hang tight, usually 2–6 minutes</p>
            <div className="stages">
              {["Queued", "Geometry", "Textures", "Finalizing"].map((label, i) => {
                const p = current.progress;
                const stageIdx = p <= 0 ? 0 : p < 50 ? 1 : p < 95 ? 2 : 3;
                const cls = i < stageIdx ? "stage-done" : i === stageIdx ? "stage-active" : "";
                return (
                  <span key={label} className={`stage ${cls}`}>
                    {i < stageIdx ? "✓" : i === stageIdx ? "●" : "○"} {label}
                  </span>
                );
              })}
            </div>
            <div className="ws-tip">
              You can keep browsing the <strong>Community</strong> gallery while this builds —
              the result lands in “My generations” automatically.
            </div>
          </div>
        )}

        {current?.status === "failed" && (
          <div className="ws-progress">
            <h3>Generation failed</h3>
            <p className="form-error">{current.error ?? "Unknown error"}</p>
          </div>
        )}

        {current?.status === "done" && current.viewerUrl && (
          <div className="ws-result">
            <ModelViewer
              src={current.viewerUrl}
              showStats
              onSnapshot={
                current.thumbnailUrl
                  ? undefined
                  : (uri) => uploadThumbnail(current.id, uri).catch(() => {})
              }
            />
            <div className="ws-result-bar">
              <strong>{current.prompt ?? "Model"}</strong>
              <button className="btn-secondary" onClick={() => setSelected(current)}>
                Details & download
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="ws-right">
        <div className="ws-right-head">
          <h2 className="ws-heading">My generations</h2>
          <input
            className="search"
            placeholder="Search my models…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="ws-history">
          {filtered.map((g) => (
            <GenerationCard
              key={g.id}
              gen={g}
              compact
              onOpen={(gen) => (gen.status === "done" ? setSelected(gen) : setCurrent(gen))}
            />
          ))}
          {filtered.length === 0 && (
            <p className="muted small">
              Your history lives here — come back any time to re-download your models.
            </p>
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
