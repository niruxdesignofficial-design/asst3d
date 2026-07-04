import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GenerationDto } from "@asst3d/shared";
import { getAuthorProfile, likeGeneration } from "../lib/api";
import { GenerationCard } from "../components/GenerationCard";
import { ModelModal } from "../components/ModelModal";
import { Avatar } from "../components/Avatar";

interface Profile {
  name: string;
  avatarUrl: string | null;
  joinedAt: number;
  modelCount: number;
  totalLikes: number;
  models: GenerationDto[];
}

/** Perfil público de un creador: /u/:name */
export function Author() {
  const { name } = useParams<{ name: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<GenerationDto | null>(null);

  useEffect(() => {
    if (!name) return;
    setProfile(null);
    setNotFound(false);
    getAuthorProfile(name)
      .then(setProfile)
      .catch(() => setNotFound(true));
  }, [name]);

  if (notFound) {
    return (
      <main className="author">
        <div className="author-head">
          <h1>Creator not found</h1>
          <p className="muted">
            No profile with that name. <Link to="/">Back to the gallery →</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="author">
      <div className="author-head">
        <Avatar
          name={profile?.name ?? name ?? "?"}
          src={profile?.avatarUrl}
          size={64}
          className="author-avatar"
        />
        <h1>{profile?.name ?? name}</h1>
        {profile && (
          <div className="author-stats">
            <span>
              <strong>{profile.modelCount}</strong> models
            </span>
            <span>
              <strong>{profile.totalLikes.toLocaleString("en-US")}</strong> likes
            </span>
            <span className="muted">
              joined {new Date(profile.joinedAt).toLocaleDateString("en-US")}
            </span>
          </div>
        )}
      </div>

      <div className="grid author-grid">
        {profile?.models.map((g) => (
          <GenerationCard
            key={g.id}
            gen={g}
            onOpen={setSelected}
            onLike={(gen) => {
              likeGeneration(gen.id)
                .then(({ likes }) =>
                  setProfile((p) =>
                    p
                      ? { ...p, models: p.models.map((m) => (m.id === gen.id ? { ...m, likes } : m)) }
                      : p
                  )
                )
                .catch(() => {});
            }}
          />
        ))}
        {profile && profile.models.length === 0 && (
          <p className="muted">This creator has no public models yet.</p>
        )}
      </div>

      {selected && <ModelModal gen={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
