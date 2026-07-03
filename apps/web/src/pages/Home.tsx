import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { GenerationDto, MeDto } from "@asst3d/shared";
import { getGeneration, likeGeneration, listDiscover } from "../lib/api";
import { GeneratePanel } from "../components/GeneratePanel";
import { GenerationCard } from "../components/GenerationCard";
import { ModelModal } from "../components/ModelModal";
import { UsageGate } from "../components/UsageGate";

interface Props {
  me: MeDto | null;
  refreshMe: () => void;
}

const FILTERS = ["Recommended", "Featured", "Recent", "All"] as const;

const SUGGESTIONS = [
  "rusty sentinel robot",
  "ancient stone golem",
  "cyberpunk hover bike",
  "cozy wooden tavern",
  "crystal cave mushroom",
] as const;

const STEPS = [
  {
    icon: "✎",
    title: "Describe it",
    body: "Type a prompt or drop a reference image. Pick an art style tuned for game engines — low-poly, stylized, pixel 3D or photoreal.",
  },
  {
    icon: "⬡",
    title: "Watch it build",
    body: "Our AI sculpts the geometry and paints full PBR textures in minutes. Follow the progress live, right in your browser.",
  },
  {
    icon: "⬇",
    title: "Drop it in your game",
    body: "Inspect topology in the 3D viewer, then export GLB, FBX, OBJ or USDZ — ready for Unity, Unreal, Godot or three.js.",
  },
] as const;

const FAQS = [
  {
    q: "Is it really free to start?",
    a: "Yes — every new visitor gets 3 free generations, no sign-up and no wallet required. When you run out, token access (coming soon) unlocks unlimited generations.",
  },
  {
    q: "What formats can I download?",
    a: "GLB out of the box for every model — the native format for Unity, Unreal, Godot and the web. Where the provider supports it you'll also see FBX, OBJ and USDZ buttons in the model page.",
  },
  {
    q: "Can I use the models commercially?",
    a: "Everything you generate publicly is released under CC0 — use it in commercial games, prototypes or jams with no attribution. Private exports arrive with token access.",
  },
  {
    q: "How long does a generation take?",
    a: "Typically 2–6 minutes depending on the queue and the detail level. You can keep browsing the gallery while it builds — your workspace tracks the progress.",
  },
] as const;

const PROMOS = [
  {
    kicker: "GETTING STARTED",
    title: "3 free generations.",
    sub: "No sign-up, no wallet. Type a prompt and go.",
    cta: "Try it now",
    to: "/workspace",
    theme: "promo-violet",
  },
  {
    kicker: "GAME-DEV PRESETS",
    title: "Low-poly to photoreal.",
    sub: "Presets tuned for engines: GLB, FBX, OBJ & USDZ out of the box.",
    cta: "Explore presets",
    to: "/workspace",
    theme: "promo-indigo",
  },
  {
    kicker: "OPEN GALLERY",
    title: "Every public creation.",
    sub: "Browse, preview in 3D and download what the community makes.",
    cta: "Browse gallery",
    to: "#discover",
    theme: "promo-fuchsia",
  },
  {
    kicker: "TOKEN ACCESS",
    title: "Unlimited is coming.",
    sub: "Hold the token, generate without limits. Private exports included.",
    cta: "Coming soon",
    to: "",
    theme: "promo-night",
  },
] as const;

export function Home({ me, refreshMe }: Props) {
  const [items, setItems] = useState<GenerationDto[]>([]);
  const [selected, setSelected] = useState<GenerationDto | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Recommended");
  const [query, setQuery] = useState("");
  const [seedPrompt, setSeedPrompt] = useState("");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    listDiscover().then(setItems).catch(() => {});
  }, []);

  // Deep link: /?model=<id> opens the detail modal (used by Share).
  useEffect(() => {
    const id = params.get("model");
    if (id) getGeneration(id).then(setSelected).catch(() => {});
  }, [params]);

  const visible = useMemo(() => {
    let list = [...items];
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (g) =>
          (g.prompt ?? "").toLowerCase().includes(q) ||
          g.authorName.toLowerCase().includes(q)
      );
    }
    switch (filter) {
      case "Featured":
        return list.sort((a, b) => b.likes - a.likes);
      case "Recent":
        return list.sort((a, b) => b.createdAt - a.createdAt);
      case "Recommended":
        // likes + recency blend so the top row feels curated
        return list.sort(
          (a, b) => b.likes + b.createdAt / 8.64e7 - (a.likes + a.createdAt / 8.64e7)
        );
      default:
        return list;
    }
  }, [items, filter, query]);

  const closeModal = () => {
    setSelected(null);
    if (params.get("model")) setParams({}, { replace: true });
  };

  return (
    <main>
      <section className="hero">
        <h1>
          Hello! <span className="accent">What will you create in 3D?</span>
        </h1>
        <p className="muted">
          Describe a character, prop or object — we turn it into a game-ready 3D model.
        </p>
        <div className="hero-box">
          <GeneratePanel
            compact
            initialPrompt={seedPrompt}
            onStarted={(gen) => {
              refreshMe();
              navigate("/workspace", { state: { focusId: gen.id } });
            }}
            onDenied={setGate}
          />
        </div>
        <div className="hero-suggestions">
          <span className="muted">Try:</span>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="suggestion" onClick={() => setSeedPrompt(s)}>
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="stats-strip">
        <div className="stat">
          <strong>2–6 min</strong>
          <span>prompt to model</span>
        </div>
        <div className="stat">
          <strong>4</strong>
          <span>art styles for games</span>
        </div>
        <div className="stat">
          <strong>GLB+</strong>
          <span>engine-ready exports</span>
        </div>
        <div className="stat">
          <strong>3 free</strong>
          <span>generations to start</span>
        </div>
      </section>

      <section className="promo-grid">
        {PROMOS.map((p) => (
          <article
            key={p.kicker}
            className={`promo-card ${p.theme}`}
            onClick={() => {
              if (p.to === "#discover")
                document.querySelector(".discover")?.scrollIntoView({ behavior: "smooth" });
              else if (p.to) navigate(p.to);
            }}
          >
            <span className="promo-kicker">{p.kicker}</span>
            <h3>{p.title}</h3>
            <p>{p.sub}</p>
            <span className="promo-cta">{p.cta} →</span>
          </article>
        ))}
      </section>

      <section className="steps">
        <h2>From words to game-ready in three steps</h2>
        <p className="muted">No modeling skills, no plugins — just describe what you need.</p>
        <div className="steps-row">
          {STEPS.map((s, i) => (
            <div key={s.title} className="step">
              <span className="step-num">{i + 1}</span>
              <span className="step-icon">{s.icon}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="discover" id="discover">
        <div className="discover-head">
          <h2>More Inspiration</h2>
          <div className="discover-tools">
            <div className="filter-tabs">
              {FILTERS.map((f) => (
                <button key={f} className={filter === f ? "tab-on" : ""} onClick={() => setFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
            <input
              className="search"
              placeholder="Search models or creators…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="grid">
          {visible.map((g) => (
            <GenerationCard
              key={g.id}
              gen={g}
              onOpen={setSelected}
              onLike={(gen) => {
                likeGeneration(gen.id)
                  .then(({ likes }) =>
                    setItems((prev) => prev.map((it) => (it.id === gen.id ? { ...it, likes } : it)))
                  )
                  .catch(() => {});
              }}
            />
          ))}
          {visible.length === 0 && (
            <p className="muted">No public models match that search — be the first to create one!</p>
          )}
        </div>
      </section>

      <section className="faq">
        <h2>Frequently asked</h2>
        {FAQS.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <section className="cta-banner">
        <h2>Your next asset is one prompt away</h2>
        <p>Start with 3 free generations — no sign-up, no credit card, no wallet.</p>
        <button className="btn-primary" onClick={() => navigate("/workspace")}>
          ✦ Open the workspace
        </button>
      </section>

      {selected && <ModelModal gen={selected} onClose={closeModal} />}
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
