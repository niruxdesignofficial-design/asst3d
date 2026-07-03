import type {
  ApiErrorCode,
  CommentDto,
  GenerateRequest,
  GenerationDto,
  MeDto,
} from "@asst3d/shared";

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode | string,
    public status: number
  ) {
    super(code);
  }
}

/** Identidad guest: un UUID por dispositivo, guardado en localStorage. */
export function getDeviceId(): string {
  const KEY = "asst3d_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

const SESSION_KEY = "asst3d_session";

export function getSession(): string | null {
  return localStorage.getItem(SESSION_KEY);
}
export function setSession(token: string | null): void {
  if (token) localStorage.setItem(SESSION_KEY, token);
  else localStorage.removeItem(SESSION_KEY);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getSession();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-device-id": getDeviceId(),
      ...(session ? { "x-session": session } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let code = "unknown";
    try {
      code = ((await res.json()) as { error?: string }).error ?? "unknown";
    } catch {
      /* respuesta sin body */
    }
    throw new ApiError(code, res.status);
  }
  return (await res.json()) as T;
}

export const getMe = () => api<MeDto>("/api/me");

export const generate = (req: GenerateRequest) =>
  api<GenerationDto>("/api/generate", { method: "POST", body: JSON.stringify(req) });

export const getGeneration = (id: string) => api<GenerationDto>(`/api/generations/${id}`);

export const listMine = () => api<GenerationDto[]>("/api/generations");

export const listDiscover = () => api<GenerationDto[]>("/api/discover");

export const likeGeneration = (id: string) =>
  api<{ likes: number }>(`/api/generations/${id}/like`, { method: "POST" });

export const uploadThumbnail = (id: string, dataUri: string) =>
  api<{ ok: true }>(`/api/generations/${id}/client-thumbnail`, {
    method: "POST",
    body: JSON.stringify({ dataUri }),
  });

export const downloadUrl = (id: string, format: string) =>
  `/api/generations/${id}/download?format=${format}`;

// ---- login con wallet ----
export const authNonce = () =>
  api<{ nonce: string; message: string }>("/api/auth/nonce", { method: "POST", body: "{}" });

export const authVerify = (address: string, signature: string) =>
  api<{ ok: true; token: string; expiresAt: number; username: string | null }>(
    "/api/auth/verify",
    { method: "POST", body: JSON.stringify({ address, signature }) }
  );

export const claimUsername = (name: string) =>
  api<{ ok: true; username: string }>("/api/users/username", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const getAuthorProfile = (name: string) =>
  api<{
    name: string;
    joinedAt: number;
    modelCount: number;
    totalLikes: number;
    models: GenerationDto[];
  }>(`/api/users/${encodeURIComponent(name)}`);

export const updateGeneration = (id: string, patch: { title?: string; isPublic?: boolean }) =>
  api<GenerationDto>(`/api/generations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteGeneration = (id: string) =>
  api<{ ok: true }>(`/api/generations/${id}`, { method: "DELETE" });

export const redeemCode = (code: string) =>
  api<{ ok: true; bonus: number; freeRemaining: number; freeLimit: number }>(
    "/api/redeem-code",
    { method: "POST", body: JSON.stringify({ code }) }
  );

export const listComments = (id: string) =>
  api<CommentDto[]>(`/api/generations/${id}/comments`);

export const postComment = (id: string, body: string) =>
  api<CommentDto>(`/api/generations/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
