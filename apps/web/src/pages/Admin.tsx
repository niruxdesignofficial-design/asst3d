import { useState } from "react";

interface Overview {
  providerBalance: number | null;
  monthlyGenerations: number;
  totalUsers: number;
  recent: {
    id: string;
    prompt: string | null;
    status: string;
    isPublic: boolean;
    reports: number;
    userId: string;
    createdAt: number;
  }[];
}

/** Panel de administración (protegido por ADMIN_TOKEN; sin token no existe). */
export function Admin() {
  const [token, setToken] = useState(sessionStorage.getItem("asst3d_admin") ?? "");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", "x-admin-token": token, ...init?.headers },
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  };

  const load = async () => {
    setError(null);
    try {
      sessionStorage.setItem("asst3d_admin", token);
      setData(await call("/api/admin/overview"));
    } catch {
      setError("Invalid token (or admin is disabled on this server)");
    }
  };

  const unpublish = async (id: string) => {
    await call(`/api/admin/generations/${id}/unpublish`, { method: "POST" }).catch(() => {});
    load();
  };

  const ban = async (userId: string) => {
    if (!window.confirm(`Ban ${userId}? They won't be able to generate anymore.`)) return;
    await call(`/api/admin/users/${encodeURIComponent(userId)}/ban`, {
      method: "POST",
      body: JSON.stringify({ banned: true }),
    }).catch(() => {});
    load();
  };

  return (
    <main className="admin">
      <h1>Admin</h1>
      {!data ? (
        <div className="promo-row admin-login">
          <input
            className="search promo-input"
            style={{ textTransform: "none" }}
            type="password"
            placeholder="Admin token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
          <button className="btn-mini" onClick={load} disabled={!token}>
            Enter
          </button>
          {error && <div className="form-error">{error}</div>}
        </div>
      ) : (
        <>
          <div className="stats-strip admin-stats">
            <div className="stat">
              <strong>{data.providerBalance ?? "—"}</strong>
              <span>provider credits left</span>
            </div>
            <div className="stat">
              <strong>{data.monthlyGenerations}</strong>
              <span>generations this month</span>
            </div>
            <div className="stat">
              <strong>{data.totalUsers}</strong>
              <span>total users</span>
            </div>
            <div className="stat">
              <strong>{data.recent.filter((r) => r.reports > 0).length}</strong>
              <span>recent with reports</span>
            </div>
          </div>

          <table className="admin-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Status</th>
                <th>Reports</th>
                <th>User</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id} className={r.reports > 0 ? "admin-flagged" : ""}>
                  <td title={r.id}>{r.prompt ?? "—"}</td>
                  <td>
                    {r.status} {r.isPublic ? "· public" : "· private"}
                  </td>
                  <td>{r.reports}</td>
                  <td title={r.userId}>{r.userId.slice(0, 10)}…</td>
                  <td className="admin-actions">
                    {r.isPublic && (
                      <button className="btn-mini" onClick={() => unpublish(r.id)}>
                        Unpublish
                      </button>
                    )}
                    <button className="btn-mini owner-delete" onClick={() => ban(r.userId)}>
                      Ban user
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
