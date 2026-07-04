import { useEffect, useState } from "react";
import {
  DOWNLOAD_FORMATS,
  MAX_COMMENT_LENGTH,
  STYLE_PRESETS,
  type CommentDto,
  type GenerationDto,
} from "@asst3d/shared";
import {
  createVariant,
  deleteGeneration,
  downloadUrl,
  getGeneration,
  likeGeneration,
  listComments,
  postComment,
  reportGeneration,
  retextureGeneration,
  updateGeneration,
} from "../lib/api";
import { useNavigate } from "react-router-dom";
import { ModelViewer } from "./ModelViewer";
import { Avatar } from "./Avatar";

interface Props {
  gen: GenerationDto;
  onClose: () => void;
  /** llamado tras editar/borrar un modelo propio, para refrescar listas */
  onChanged?: () => void;
}

/** Model detail: big viewer + info panel with downloads and comments. */
export function ModelModal({ gen, onClose, onChanged }: Props) {
  const [likes, setLikes] = useState(gen.likes);
  const [title, setTitle] = useState(gen.prompt ?? "Untitled");
  const [isPublic, setIsPublic] = useState(gen.isPublic);
  const [editing, setEditing] = useState(false);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [variants, setVariants] = useState<string[]>(gen.variants ?? []);
  const [variantBusy, setVariantBusy] = useState<string | null>(null);
  const [retexOpen, setRetexOpen] = useState(false);
  const [retexPrompt, setRetexPrompt] = useState("");
  const navigate = useNavigate();

  const optimize = async (preset: "mobile" | "pc") => {
    setVariantBusy(preset);
    try {
      await createVariant(gen.id, preset);
      // poll hasta que la variante quede cacheada (remesh tarda ~30-90s)
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const fresh = await getGeneration(gen.id);
        if (fresh.variants.includes(preset)) {
          setVariants(fresh.variants);
          break;
        }
      }
    } catch {
      /* el server ya hizo refund si falló */
    } finally {
      setVariantBusy(null);
    }
  };

  const retexture = async () => {
    const style = retexPrompt.trim();
    if (!style) return;
    setOwnerBusy(true);
    try {
      const created = await retextureGeneration(gen.id, style);
      onChanged?.();
      onClose();
      navigate("/workspace", { state: { focusId: created.id } });
    } catch {
      setRetexOpen(false);
    } finally {
      setOwnerBusy(false);
    }
  };

  const remix = () => {
    onClose();
    navigate("/workspace", { state: { remixPrompt: gen.prompt ?? "" } });
  };

  const saveTitle = async () => {
    const t = title.trim();
    if (!t || t === gen.prompt) return setEditing(false);
    setOwnerBusy(true);
    try {
      await updateGeneration(gen.id, { title: t });
      setEditing(false);
      onChanged?.();
    } catch {
      setTitle(gen.prompt ?? "Untitled");
    } finally {
      setOwnerBusy(false);
    }
  };

  const togglePublic = async () => {
    setOwnerBusy(true);
    try {
      const updated = await updateGeneration(gen.id, { isPublic: !isPublic });
      setIsPublic(updated.isPublic);
      onChanged?.();
    } catch {
      /* sin cambios */
    } finally {
      setOwnerBusy(false);
    }
  };

  const removeModel = async () => {
    if (!window.confirm("Delete this model forever? This cannot be undone.")) return;
    setOwnerBusy(true);
    try {
      await deleteGeneration(gen.id);
      onChanged?.();
      onClose();
    } finally {
      setOwnerBusy(false);
    }
  };
  const [comments, setComments] = useState<CommentDto[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    listComments(gen.id).then(setComments).catch(() => {});
  }, [gen.id]);

  const style = STYLE_PRESETS.find((s) => s.id === gen.styleId);

  const share = () => {
    navigator.clipboard
      .writeText(`${location.origin}/m/${gen.id}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };

  const sendComment = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const c = await postComment(gen.id, body);
      setComments((prev) => [...prev, c]);
      setDraft("");
    } catch {
      /* keep the draft so the user can retry */
    } finally {
      setSending(false);
    }
  };

  const timeAgo = (ts: number) => {
    const days = Math.floor((Date.now() - ts) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕ Close
        </button>
        <div className="modal-viewer">
          {gen.viewerUrl ? (
            <ModelViewer src={gen.viewerUrl} showStats />
          ) : (
            <div className="viewer-overlay">Model unavailable</div>
          )}
        </div>
        <aside className="modal-side">
          <div className="modal-author">
            <Avatar name={gen.authorName} src={gen.authorAvatar} size={34} />
            <div className="modal-author-info">
              <strong>{gen.authorName}</strong>
              <div className="muted small">{timeAgo(gen.createdAt)}</div>
            </div>
            <button className="btn-mini" disabled title="Profiles coming soon">
              + Follow
            </button>
          </div>

          {editing ? (
            <div className="promo-row">
              <input
                className="search promo-input"
                style={{ textTransform: "none" }}
                value={title}
                maxLength={120}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveTitle()}
              />
              <button className="btn-mini" disabled={ownerBusy} onClick={saveTitle}>
                Save
              </button>
            </div>
          ) : (
            <h2 className="modal-title">{title}</h2>
          )}

          {gen.isMine && (
            <div className="owner-row">
              <button className="btn-mini" onClick={() => setEditing(true)} disabled={ownerBusy}>
                ✎ Rename
              </button>
              <button className="btn-mini" onClick={togglePublic} disabled={ownerBusy}>
                {isPublic ? "🔓 Public" : "🔒 Private"}
              </button>
              <button className="btn-mini owner-delete" onClick={removeModel} disabled={ownerBusy}>
                🗑 Delete
              </button>
            </div>
          )}

          <div className="tag-row">
            {style && <span className="tag">{style.label}</span>}
            <span className="tag">{gen.kind === "text" ? "text → 3D" : "image → 3D"}</span>
            <span className="tag">game-ready</span>
            <span className="tag tag-license">CC0</span>
          </div>

          <div className="modal-section">
            <h3>Download</h3>
            <p className="muted small">Formats ready for your game engine</p>
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

            {gen.supportsVariants && (
              <div className="variant-row">
                {(["mobile", "pc"] as const).map((preset) =>
                  variants.includes(preset) ? (
                    <a
                      key={preset}
                      className="btn-mini"
                      href={`${downloadUrl(gen.id, "glb")}&preset=${preset}`}
                      download
                    >
                      ⬇ {preset === "mobile" ? "Mobile ~5k" : "PC ~30k"}
                    </a>
                  ) : gen.isMine ? (
                    <button
                      key={preset}
                      className="btn-mini"
                      disabled={variantBusy !== null}
                      title="Optimized remesh — uses 1 generation"
                      onClick={() => optimize(preset)}
                    >
                      {variantBusy === preset
                        ? "Optimizing…"
                        : `⚙ ${preset === "mobile" ? "Mobile ~5k" : "PC ~30k"}`}
                    </button>
                  ) : null
                )}
              </div>
            )}
          </div>

          {gen.isMine && gen.supportsVariants && (
            <div className="modal-section">
              <h3>Iterate</h3>
              <div className="owner-row">
                <button className="btn-mini" onClick={remix} title="New generation, same prompt">
                  🎲 Remix
                </button>
                <button
                  className="btn-mini"
                  onClick={() => setRetexOpen((v) => !v)}
                  title="New textures on this same mesh — uses 1 generation"
                >
                  🎨 Retexture
                </button>
              </div>
              {retexOpen && (
                <div className="promo-row" style={{ marginTop: 10 }}>
                  <input
                    className="search promo-input"
                    style={{ textTransform: "none" }}
                    placeholder="New style… e.g. gold plated, sci-fi neon"
                    value={retexPrompt}
                    maxLength={300}
                    autoFocus
                    onChange={(e) => setRetexPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && retexture()}
                  />
                  <button
                    className="btn-mini"
                    disabled={ownerBusy || !retexPrompt.trim()}
                    onClick={retexture}
                  >
                    Go
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button
              className="btn-secondary"
              onClick={() => {
                likeGeneration(gen.id)
                  .then(({ likes: n }) => setLikes(n))
                  .catch(() => {});
              }}
            >
              ♥ {likes}
            </button>
            <button className="btn-secondary" onClick={share}>
              {copied ? "✓ Link copied" : "↗ Share"}
            </button>
            {!gen.isMine && (
              <button
                className="btn-mini report-btn"
                title="Report this model"
                onClick={() => {
                  if (!window.confirm("Report this model as inappropriate?")) return;
                  reportGeneration(gen.id).catch(() => {});
                }}
              >
                ⚑
              </button>
            )}
          </div>

          <div className="modal-section comments">
            <h3>
              {comments.length === 0
                ? "Comments"
                : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}
            </h3>
            <div className="comment-list">
              {comments.map((c) => (
                <div key={c.id} className="comment">
                  <Avatar name={c.authorName} src={c.authorAvatar} size={20} />
                  <div>
                    <div className="comment-head">
                      <strong>{c.authorName}</strong>
                      <span className="muted small">{timeAgo(c.createdAt)}</span>
                    </div>
                    <p>{c.body}</p>
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <p className="muted small">Be the first to comment on this model.</p>
              )}
            </div>
            <div className="comment-box">
              <input
                className="search"
                placeholder="Post a comment…"
                value={draft}
                maxLength={MAX_COMMENT_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendComment()}
              />
              <button className="btn-mini" disabled={sending || !draft.trim()} onClick={sendComment}>
                Send
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
