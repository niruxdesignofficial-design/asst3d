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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-device-id": getDeviceId(),
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
