import { useEffect, useState } from "react";
import type { GenerationDto } from "@asst3d/shared";
import { thumbnailFor } from "../lib/thumbs";

interface Props {
  gen: GenerationDto;
  onOpen: (gen: GenerationDto) => void;
  onLike?: (gen: GenerationDto) => void;
}

/** Tarjeta de la galería: thumbnail (renderizado en cliente si hace falta) + meta. */
export function GenerationCard({ gen, onOpen, onLike }: Props) {
  const [thumb, setThumb] = useState<string | null>(gen.thumbnailUrl);

  useEffect(() => {
    if (gen.thumbnailUrl) {
      setThumb(gen.thumbnailUrl);
      return;
    }
    if (gen.viewerUrl) {
      let alive = true;
      thumbnailFor(gen.viewerUrl).then((uri) => alive && setThumb(uri)).catch(() => {});
      return () => {
        alive = false;
      };
    }
  }, [gen.thumbnailUrl, gen.viewerUrl]);

  return (
    <article className="card" onClick={() => onOpen(gen)}>
      <div className="card-media">
        {thumb ? (
          <img src={thumb} alt={gen.prompt ?? "modelo 3D"} loading="lazy" />
        ) : (
          <div className="card-media-placeholder">◇</div>
        )}
        <span className="card-badge">{gen.kind === "text" ? "Texto a 3D" : "Imagen a 3D"}</span>
      </div>
      <footer className="card-footer">
        <div className="card-title" title={gen.prompt ?? undefined}>
          {gen.prompt ?? "Sin título"}
        </div>
        <div className="card-meta">
          <span className="card-author">
            <span className="avatar-dot" aria-hidden>
              {gen.authorName.slice(0, 1).toUpperCase()}
            </span>
            {gen.authorName}
          </span>
          <button
            className="like-btn"
            onClick={(e) => {
              e.stopPropagation();
              onLike?.(gen);
            }}
            title="Me gusta"
          >
            ♥ {gen.likes}
          </button>
        </div>
      </footer>
    </article>
  );
}
