import { useEffect, useState } from "react";
import type { GenerationDto } from "@asst3d/shared";
import { thumbnailFor } from "../lib/thumbs";
import { downloadUrl } from "../lib/api";

interface Props {
  gen: GenerationDto;
  onOpen: (gen: GenerationDto) => void;
  onLike?: (gen: GenerationDto) => void;
  compact?: boolean;
}

/** Gallery card: thumbnail (client-rendered if needed) + meta + hover actions. */
export function GenerationCard({ gen, onOpen, onLike, compact = false }: Props) {
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
    <article className={`card ${compact ? "card-compact" : ""}`} onClick={() => onOpen(gen)}>
      <div className="card-media">
        {thumb ? (
          <img src={thumb} alt={gen.prompt ?? "3D model"} loading="lazy" />
        ) : (
          <>
            <div className="card-skeleton" />
            <div className="card-media-placeholder">◇</div>
          </>
        )}
        <span className="card-badge">{gen.kind === "text" ? "Text to 3D" : "Image to 3D"}</span>
        {!compact && gen.status === "done" && (
          <div className="card-hover">
            <button className="btn-mini" onClick={(e) => { e.stopPropagation(); onOpen(gen); }}>
              ✦ View
            </button>
            <a
              className="btn-mini"
              href={downloadUrl(gen.id, "glb")}
              download
              onClick={(e) => e.stopPropagation()}
            >
              ⬇ GLB
            </a>
          </div>
        )}
      </div>
      <footer className="card-footer">
        <div className="card-title" title={gen.prompt ?? undefined}>
          {gen.prompt ?? "Untitled"}
        </div>
        <div className="card-meta">
          <span
            className="card-author"
            title={gen.authorName !== "guest" ? `View ${gen.authorName}'s profile` : undefined}
            onClick={(e) => {
              if (gen.authorName === "guest") return;
              e.stopPropagation();
              window.location.href = `/u/${encodeURIComponent(gen.authorName)}`;
            }}
          >
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
            title="Like"
          >
            ♥ {gen.likes}
          </button>
        </div>
      </footer>
    </article>
  );
}
