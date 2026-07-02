import { useEffect } from "react";
import { DOWNLOAD_FORMATS, STYLE_PRESETS, type GenerationDto } from "@asst3d/shared";
import { downloadUrl, likeGeneration } from "../lib/api";
import { ModelViewer } from "./ModelViewer";

interface Props {
  gen: GenerationDto;
  onClose: () => void;
}

/** Detalle de modelo: visor grande + panel con info y descargas (como Meshy). */
export function ModelModal({ gen, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const style = STYLE_PRESETS.find((s) => s.id === gen.styleId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">
          ✕ Cerrar
        </button>
        <div className="modal-viewer">
          {gen.viewerUrl ? (
            <ModelViewer src={gen.viewerUrl} />
          ) : (
            <div className="viewer-overlay">Modelo no disponible</div>
          )}
        </div>
        <aside className="modal-side">
          <div className="modal-author">
            <span className="avatar-dot big">{gen.authorName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{gen.authorName}</strong>
              <div className="muted small">
                {new Date(gen.createdAt).toLocaleDateString("es-AR")}
              </div>
            </div>
          </div>

          <h2 className="modal-title">{gen.prompt ?? "Sin título"}</h2>

          <div className="tag-row">
            {style && <span className="tag">{style.label}</span>}
            <span className="tag">{gen.kind === "text" ? "texto → 3D" : "imagen → 3D"}</span>
            <span className="tag">game-ready</span>
          </div>

          <div className="modal-section">
            <h3>Descargar</h3>
            <p className="muted small">Formatos listos para tu motor de juego</p>
            <div className="dl-grid">
              {DOWNLOAD_FORMATS.map((f) => {
                const available = gen.formats.includes(f);
                return (
                  <a
                    key={f}
                    className={`dl-btn ${available ? "" : "dl-off"}`}
                    href={available ? downloadUrl(gen.id, f) : undefined}
                    download
                    onClick={(e) => !available && e.preventDefault()}
                  >
                    ⬇ {f.toUpperCase()}
                  </a>
                );
              })}
            </div>
          </div>

          <div className="modal-section">
            <button
              className="btn-secondary"
              onClick={() => likeGeneration(gen.id).catch(() => {})}
            >
              ♥ Me gusta ({gen.likes})
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
