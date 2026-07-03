import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { GenerationDto } from "@asst3d/shared";
import { getGeneration } from "../lib/api";
import { ModelModal } from "../components/ModelModal";

/**
 * Página compartible por modelo (/m/:id): el server inyecta las metas OG
 * para que el link se vea con card en X/Discord; acá se renderiza el detalle.
 */
export function ModelPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gen, setGen] = useState<GenerationDto | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    getGeneration(id)
      .then(setGen)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <main className="author">
        <div className="author-head">
          <h1>Model not found</h1>
          <p className="muted">It may have been removed or made private.</p>
          <button className="btn-primary" onClick={() => navigate("/")}>
            Browse the gallery
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "60vh" }}>
      {gen && <ModelModal gen={gen} onClose={() => navigate("/")} />}
    </main>
  );
}
