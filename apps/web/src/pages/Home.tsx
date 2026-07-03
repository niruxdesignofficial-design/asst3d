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
            onStarted={(gen) => {
              refreshMe();
              navigate("/workspace", { state: { focusId: gen.id } });
            }}
            onDenied={setGate}
          />
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
