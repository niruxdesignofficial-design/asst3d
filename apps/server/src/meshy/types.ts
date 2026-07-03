// Superficie mínima de la API de Meshy que usa la app.
// Docs: https://docs.meshy.ai (text-to-3d v2, image-to-3d v1, balance v1)

export type MeshyStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface MeshyTask {
  id: string;
  status: MeshyStatus;
  progress: number;
  model_urls?: Partial<Record<"glb" | "fbx" | "obj" | "usdz" | "mtl", string>>;
  thumbnail_url?: string;
  task_error?: { message?: string } | null;
}

export interface TextTo3DOptions {
  prompt: string;
  modelType: "standard" | "lowpoly";
  targetPolycount?: number;
  /** Meshy ai_model id (e.g. "latest", "meshy-5") */
  aiModel?: string;
}

export interface ImageTo3DOptions {
  imageDataUri: string;
  modelType: "standard" | "lowpoly";
  targetPolycount?: number;
}

/**
 * Cliente Meshy: una sola interfaz que implementan el cliente real y el mock,
 * así el resto del server no sabe (ni le importa) en qué modo corre.
 */
export interface MeshyClient {
  /** text-to-3D paso 1: geometría sin textura */
  createTextPreview(opts: TextTo3DOptions): Promise<string>;
  /** text-to-3D paso 2: texturas sobre el preview */
  createTextRefine(previewTaskId: string): Promise<string>;
  createImageTo3D(opts: ImageTo3DOptions): Promise<string>;
  getTask(taskId: string, kind: "text" | "image"): Promise<MeshyTask>;
  /** Créditos restantes de la cuenta Meshy */
  getBalance(): Promise<number>;
}
