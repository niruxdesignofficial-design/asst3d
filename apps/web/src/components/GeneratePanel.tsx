import { useRef, useState } from "react";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  STYLE_PRESETS,
  type GenerationDto,
  type GenerationKind,
} from "@asst3d/shared";
import { ApiError, generate } from "../lib/api";

interface Props {
  onStarted: (gen: GenerationDto) => void;
  onDenied: (code: string) => void;
  /** compacto = caja de la home; completo = panel del workspace */
  compact?: boolean;
}

/** Formulario de generación (texto o imagen). La decisión de si puede generar es del server. */
export function GeneratePanel({ onStarted, onDenied, compact = false }: Props) {
  const [kind, setKind] = useState<GenerationKind>("text");
  const [prompt, setPrompt] = useState("");
  const [styleId, setStyleId] = useState(STYLE_PRESETS[0].id);
  const [image, setImage] = useState<{ dataUri: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickImage = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Formato no soportado (png, jpg o webp)");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("La imagen supera los 20MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage({ dataUri: String(reader.result), name: file.name });
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setError(null);
    if (kind === "text" && !prompt.trim()) {
      setError("Contanos qué querés crear");
      return;
    }
    if (kind === "image" && !image) {
      setError("Subí una imagen primero");
      return;
    }
    setBusy(true);
    try {
      const gen = await generate({
        kind,
        prompt: prompt.trim() || undefined,
        imageDataUri: image?.dataUri,
        styleId,
      });
      onStarted(gen);
      setPrompt("");
      setImage(null);
    } catch (err) {
      if (err instanceof ApiError) {
        if (["free_limit_reached", "capacity_reached", "rate_limited"].includes(err.code)) {
          onDenied(err.code);
        } else {
          setError("No se pudo iniciar la generación. Probá de nuevo.");
        }
      } else {
        setError("Error de conexión");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`gen-panel ${compact ? "gen-compact" : ""}`}>
      <div className="seg">
        <button className={kind === "text" ? "seg-on" : ""} onClick={() => setKind("text")}>
          ✦ Texto a 3D
        </button>
        <button className={kind === "image" ? "seg-on" : ""} onClick={() => setKind("image")}>
          ◫ Imagen a 3D
        </button>
      </div>

      {kind === "text" ? (
        <textarea
          className="gen-input"
          placeholder="Describí tu modelo… ej: robot centinela oxidado con un ojo que brilla"
          value={prompt}
          maxLength={500}
          rows={compact ? 2 : 4}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
      ) : (
        <div
          className={`dropzone ${image ? "dropzone-full" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pickImage(e.dataTransfer.files[0]);
          }}
        >
          {image ? (
            <>
              <img src={image.dataUri} alt={image.name} />
              <span className="muted small">{image.name} — click para cambiar</span>
            </>
          ) : (
            <>
              <div className="dropzone-icon">⇪</div>
              <div>Click / arrastrá / pegá una imagen</div>
              <div className="muted small">png, jpg o webp · máx 20MB</div>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            hidden
            onChange={(e) => pickImage(e.target.files?.[0])}
          />
        </div>
      )}

      <div className="preset-row">
        {STYLE_PRESETS.map((s) => (
          <button
            key={s.id}
            className={`chip ${styleId === s.id ? "chip-on" : ""}`}
            title={s.blurb}
            onClick={() => setStyleId(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      <button className="btn-primary" disabled={busy} onClick={submit}>
        {busy ? "Iniciando…" : "✦ Generar modelo"}
      </button>
    </div>
  );
}
