// Tipos y constantes compartidas entre server y web.

export type GenerationKind = "text" | "image";

export type GenerationStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed";

/** Etapa interna de una task de texto (Meshy es preview -> refine). */
export type GenerationStage = "preview" | "refine";

export type ModelType = "standard" | "lowpoly";

export interface StylePreset {
  id: string;
  /** Nombre visible en la UI */
  label: string;
  /** Descripción corta para la UI */
  blurb: string;
  /** Sufijo que se agrega al prompt del usuario */
  promptSuffix: string;
  /** Parámetros Meshy que fuerza el preset */
  modelType: ModelType;
  targetPolycount?: number;
}

/** Presets de estilo pensados para game-dev (la diferenciación vs Meshy genérico). */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "lowpoly",
    label: "Low-poly",
    blurb: "Geometría liviana, ideal para juegos web y móviles",
    promptSuffix: "low poly game asset, clean silhouette, flat shaded",
    modelType: "lowpoly",
    targetPolycount: 3000,
  },
  {
    id: "realista",
    label: "Realista",
    blurb: "Alto detalle con texturas PBR",
    promptSuffix: "realistic game-ready asset, detailed PBR materials",
    modelType: "standard",
  },
  {
    id: "stylized",
    label: "Stylized",
    blurb: "Estilo hand-painted tipo Fortnite / Overwatch",
    promptSuffix: "stylized hand-painted game asset, exaggerated shapes, vibrant colors",
    modelType: "standard",
  },
  {
    id: "pixel3d",
    label: "Pixel 3D",
    blurb: "Voxel / pixel-art en 3D",
    promptSuffix: "voxel style 3d pixel art game asset, blocky, chunky shapes",
    modelType: "lowpoly",
    targetPolycount: 1500,
  },
];

export const DOWNLOAD_FORMATS = ["glb", "fbx", "obj", "usdz"] as const;
export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];

export const MAX_PROMPT_LENGTH = 600; // límite de la API de Meshy
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB, límite de Meshy
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Fila de generación tal como la expone la API (nunca incluye datos internos de Meshy). */
export interface GenerationDto {
  id: string;
  kind: GenerationKind;
  prompt: string | null;
  styleId: string;
  status: GenerationStatus;
  progress: number;
  /** Formatos disponibles para descargar cuando status === done */
  formats: DownloadFormat[];
  thumbnailUrl: string | null;
  /** URL para cargar el GLB en el visor (proxy del server) */
  viewerUrl: string | null;
  error: string | null;
  isPublic: boolean;
  authorName: string;
  likes: number;
  createdAt: number;
}

export interface MeDto {
  deviceId: string;
  freeLimit: number;
  freeUsed: number;
  freeRemaining: number;
  /** false cuando la app llegó al tope global del mes */
  capacityOk: boolean;
  paymentsEnabled: boolean;
  /** true si el usuario tiene acceso pago (token) */
  hasTokenAccess: boolean;
  walletAddress: string | null;
}

export interface GenerateRequest {
  kind: GenerationKind;
  prompt?: string;
  /** data URI base64 (image/png|jpeg|webp) para image-to-3D */
  imageDataUri?: string;
  styleId?: string;
  isPublic?: boolean;
}

/** Códigos de error que la UI sabe mostrar */
export type ApiErrorCode =
  | "rate_limited"
  | "free_limit_reached"
  | "capacity_reached"
  | "payments_off"
  | "invalid_input"
  | "not_found";
