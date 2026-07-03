import { useEffect, useRef, useState } from "react";
import {
  ACCEPTED_IMAGE_TYPES,
  AI_MODELS,
  MAX_IMAGE_BYTES,
  POLYCOUNT_MAX,
  POLYCOUNT_MIN,
  STYLE_PRESETS,
  type AiModelId,
  type GenerationDto,
  type GenerationKind,
  type ModelType,
} from "@asst3d/shared";
import { ApiError, generate } from "../lib/api";

/**
 * Heurística liviana: el modelo 3D entiende inglés (y chino); prompts en
 * español/portugués suelen generar el objeto equivocado. Detectamos señales
 * comunes para sugerir escribir en inglés — solo un aviso, nunca bloquea.
 */
function looksNonEnglish(prompt: string): boolean {
  if (prompt.trim().length < 4) return false;
  if (/[áéíóúñü¿¡ãõç]/i.test(prompt)) return true;
  return /\b(que|una|unos?|està|esta|con|para|pero|perro|gato|hombre|mujer|casa|coche|árbol|niño|estilo|parece|hecho|muy)\b/i.test(
    prompt
  );
}

interface Props {
  onStarted: (gen: GenerationDto) => void;
  onDenied: (code: string) => void;
  /** compact = home hero box; full = workspace panel with advanced controls */
  compact?: boolean;
  /** prefill the prompt (e.g. suggestion chips); updates when it changes */
  initialPrompt?: string;
}

/** Generation form (text or image). Whether it CAN generate is always the server's call. */
export function GeneratePanel({ onStarted, onDenied, compact = false, initialPrompt }: Props) {
  const [kind, setKind] = useState<GenerationKind>("text");
  const [prompt, setPrompt] = useState("");
  const [styleId, setStyleId] = useState(STYLE_PRESETS[0].id);
  const [modelType, setModelType] = useState<ModelType | null>(null);
  const [polycount, setPolycount] = useState<number | null>(null);
  const [aiModelId, setAiModelId] = useState<AiModelId>(AI_MODELS[0].id);
  const [image, setImage] = useState<{ dataUri: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialPrompt) {
      setKind("text");
      setPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  const style = STYLE_PRESETS.find((s) => s.id === styleId) ?? STYLE_PRESETS[0];
  const effectiveType = modelType ?? style.modelType;
  const effectivePoly = polycount ?? style.targetPolycount;

  const pickImage = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Unsupported format (png, jpg or webp)");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image is over 20MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage({ dataUri: String(reader.result), name: file.name });
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setError(null);
    if (kind === "text" && !prompt.trim()) {
      setError("Tell us what you want to create");
      return;
    }
    if (kind === "image" && !image) {
      setError("Upload an image first");
      return;
    }
    setBusy(true);
    try {
      const gen = await generate({
        kind,
        prompt: prompt.trim() || undefined,
        imageDataUri: image?.dataUri,
        styleId,
        modelType: modelType ?? undefined,
        targetPolycount: polycount ?? undefined,
        aiModelId,
      });
      onStarted(gen);
      setPrompt("");
      setImage(null);
    } catch (err) {
      if (err instanceof ApiError) {
        if (["free_limit_reached", "capacity_reached", "rate_limited"].includes(err.code)) {
          onDenied(err.code);
        } else {
          setError("Could not start the generation. Please try again.");
        }
      } else {
        setError("Connection error");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`gen-panel ${compact ? "gen-compact" : ""}`}>
      <div className="seg">
        <button className={kind === "text" ? "seg-on" : ""} onClick={() => setKind("text")}>
          ✦ Text to 3D
        </button>
        <button className={kind === "image" ? "seg-on" : ""} onClick={() => setKind("image")}>
          ◫ Image to 3D
        </button>
      </div>

      {kind === "text" ? (
        <>
          <textarea
            className="gen-input"
            placeholder="Describe your model… e.g. rusty sentinel robot with one glowing eye"
            value={prompt}
            maxLength={500}
            rows={compact ? 2 : 4}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          {looksNonEnglish(prompt) && (
            <div className="lang-hint">
              💡 The AI understands <strong>English</strong> best — non-English prompts often
              produce the wrong object. Try describing it in English (e.g. “a monkey that looks
              like a man”).
            </div>
          )}
        </>
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
              <span className="muted small">{image.name} — click to change</span>
            </>
          ) : (
            <>
              <div className="dropzone-icon">⇪</div>
              <div>Click / drag & drop / paste an image</div>
              <div className="muted small">png, jpg or webp · max 20MB</div>
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

      <div className="field">
        <label className="field-label">Art style</label>
        <div className="preset-row">
          {STYLE_PRESETS.map((s) => (
            <button
              key={s.id}
              className={`chip ${styleId === s.id ? "chip-on" : ""}`}
              title={s.blurb}
              onClick={() => {
                setStyleId(s.id);
                setModelType(null);
                setPolycount(null);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!compact && (
        <>
          <div className="field">
            <label className="field-label">Model type</label>
            <div className="seg seg-block">
              <button
                className={effectiveType === "standard" ? "seg-on" : ""}
                onClick={() => setModelType("standard")}
              >
                Standard
              </button>
              <button
                className={effectiveType === "lowpoly" ? "seg-on" : ""}
                onClick={() => setModelType("lowpoly")}
              >
                Low Polygon
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              Target polycount{" "}
              <span className="muted">
                {effectivePoly ? effectivePoly.toLocaleString("en-US") : "auto"}
              </span>
            </label>
            <input
              type="range"
              className="slider"
              min={POLYCOUNT_MIN}
              max={POLYCOUNT_MAX}
              step={500}
              value={effectivePoly ?? 30000}
              onChange={(e) => setPolycount(Number(e.target.value))}
            />
          </div>

          <div className="field">
            <label className="field-label">AI model</label>
            <select
              className="select"
              value={aiModelId}
              onChange={(e) => setAiModelId(e.target.value as AiModelId)}
            >
              {AI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label">License</label>
            <div className="seg seg-block">
              <button className="seg-on">Public · CC0</button>
              <button disabled title="Private exports arrive with token access">
                Private 🔒
              </button>
            </div>
          </div>

          <div className="cost-row">
            <span className="muted small">≈ 2 min</span>
            <span className="muted small">·</span>
            <span className="small">1 free generation</span>
          </div>
        </>
      )}

      {error && <div className="form-error">{error}</div>}

      <button className="btn-primary" disabled={busy} onClick={submit}>
        {busy ? "Starting…" : "✦ Generate model"}
      </button>
    </div>
  );
}
