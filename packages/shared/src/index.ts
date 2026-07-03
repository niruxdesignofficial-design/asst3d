// Shared types & constants between server and web.

export type GenerationKind = "text" | "image";

export type GenerationStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed";

/** Internal stage of a text task (Meshy is preview -> refine). */
export type GenerationStage = "preview" | "refine";

export type ModelType = "standard" | "lowpoly";

export interface StylePreset {
  id: string;
  /** Label shown in the UI */
  label: string;
  /** Short description for the UI */
  blurb: string;
  /** Suffix appended to the user's prompt */
  promptSuffix: string;
  /** Meshy params enforced by the preset */
  modelType: ModelType;
  targetPolycount?: number;
}

/** Game-dev style presets (our differentiation vs generic Meshy). */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "lowpoly",
    label: "Low-poly",
    blurb: "Lightweight geometry, perfect for web & mobile games",
    promptSuffix: "low poly game asset, clean silhouette, flat shaded",
    modelType: "lowpoly",
    targetPolycount: 3000,
  },
  {
    id: "realistic",
    label: "Realistic",
    blurb: "High detail with PBR textures",
    promptSuffix: "realistic game-ready asset, detailed PBR materials",
    modelType: "standard",
  },
  {
    id: "stylized",
    label: "Stylized",
    blurb: "Hand-painted look, bold shapes and vibrant colors",
    promptSuffix: "stylized hand-painted game asset, exaggerated shapes, vibrant colors",
    modelType: "standard",
  },
  {
    id: "pixel3d",
    label: "Pixel 3D",
    blurb: "Voxel / 3D pixel-art style",
    promptSuffix: "voxel style 3d pixel art game asset, blocky, chunky shapes",
    modelType: "lowpoly",
    targetPolycount: 1500,
  },
];

/** AI model options shown in the workspace (mapped server-side to Meshy's ai_model). */
export const AI_MODELS = [
  // El primero es el default de la UI — meshy-5 cuesta 4x menos que el último modelo
  { id: "asst-1", label: "Formora-1 (fast)", meshy: "meshy-5" },
  { id: "asst-2", label: "Formora-2 (ultra)", meshy: "latest" },
] as const;
export type AiModelId = (typeof AI_MODELS)[number]["id"];

export const POLYCOUNT_MIN = 500;
export const POLYCOUNT_MAX = 100_000;

/** Velocidad de generación: fast ≈ 30-60s (TRELLIS), quality ≈ 2-6 min (más detalle). */
export type GenerationSpeed = "fast" | "quality";
export const SPEED_OPTIONS: { id: GenerationSpeed; label: string; blurb: string }[] = [
  { id: "fast", label: "⚡ Fast", blurb: "~15-30 seconds — great for quick iteration" },
  { id: "quality", label: "✦ Quality", blurb: "2-6 minutes — more detail and cleaner textures" },
];

export const DOWNLOAD_FORMATS = ["glb", "fbx", "obj", "usdz"] as const;
export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];

export const MAX_PROMPT_LENGTH = 600; // Meshy API limit
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB, Meshy limit
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_COMMENT_LENGTH = 400;

/** Generation row as exposed by the API (never includes internal Meshy data). */
export interface GenerationDto {
  id: string;
  kind: GenerationKind;
  prompt: string | null;
  styleId: string;
  status: GenerationStatus;
  progress: number;
  /** Formats available for download when status === done */
  formats: DownloadFormat[];
  thumbnailUrl: string | null;
  /** URL to load the GLB in the viewer (server proxy) */
  viewerUrl: string | null;
  error: string | null;
  isPublic: boolean;
  authorName: string;
  /** true si el modelo pertenece al usuario del request */
  isMine: boolean;
  /** presets de export ya cacheados (mobile/pc) */
  variants: string[];
  /** true si soporta post-procesado Meshy (remesh/retexture) */
  supportsVariants: boolean;
  likes: number;
  createdAt: number;
}

export interface CommentDto {
  id: number;
  authorName: string;
  body: string;
  createdAt: number;
}

export interface MeDto {
  deviceId: string;
  /** id de cuenta efectivo (address si hay wallet conectada) */
  userId: string;
  /** username reservado, o null si todavía no eligió */
  username: string | null;
  freeLimit: number;
  freeUsed: number;
  freeRemaining: number;
  /** false when the app hit the global monthly cap */
  capacityOk: boolean;
  paymentsEnabled: boolean;
  /** true if the user has paid (token) access */
  hasTokenAccess: boolean;
  walletAddress: string | null;
  /** proveedor del modo Fast si hay alguno configurado; null = todo va al default */
  fastProvider: string | null;
}

export interface GenerateRequest {
  kind: GenerationKind;
  prompt?: string;
  /** base64 data URI (image/png|jpeg|webp) for image-to-3D */
  imageDataUri?: string;
  styleId?: string;
  /** Optional overrides on top of the preset */
  modelType?: ModelType;
  targetPolycount?: number;
  aiModelId?: AiModelId;
  speed?: GenerationSpeed;
  isPublic?: boolean;
}

/** Error codes the UI knows how to render */
export type ApiErrorCode =
  | "rate_limited"
  | "free_limit_reached"
  | "capacity_reached"
  | "payments_off"
  | "invalid_input"
  | "not_found";
