import type { Repo, GenerationRow } from "./db/repo.js";
import type { MeshyClient } from "./meshy/types.js";

/**
 * Un solo loop en el server consulta las tasks activas al proveedor y actualiza
 * la DB. Los clientes hacen polling contra NUESTRA DB, nunca contra el proveedor.
 *
 * Los proveedores twoStage (Meshy: preview->refine; Fast: imagen->TRELLIS)
 * encadenan la segunda etapa automáticamente.
 */
const MAX_CONSECUTIVE_ERRORS = 5;

export class JobPoller {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  /** Errores de red seguidos por job: un tropiezo transitorio no mata la generación. */
  private errCounts = new Map<string, number>();

  constructor(
    private repo: Repo,
    private meshy: MeshyClient,
    private intervalMs = 3000,
    /**
     * Hook opcional para persistir modelo+thumbnail al completar (las URLs de
     * los proveedores expiran). Devuelve las refs definitivas.
     */
    private persist?: (
      generationId: string,
      urls: Record<string, string>,
      thumbnailUrl?: string | null
    ) => Promise<{ urls: Record<string, string>; thumbnailUrl: string | null }>,
    /** Clientes extra por proveedor (ej. "fast"); si no matchea, usa el default. */
    private clients?: Record<string, MeshyClient>
  ) {}

  private clientFor(row: GenerationRow): MeshyClient {
    return (row.provider && this.clients?.[row.provider]) || this.meshy;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.busy) return; // no solapar ticks si el proveedor tarda
    this.busy = true;
    try {
      for (const row of await this.repo.listActive()) {
        try {
          await this.advance(row);
          this.errCounts.delete(row.id);
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          // Rate-limit del proveedor: no es un error del job, solo hay que esperar.
          if (msg.includes("429") || msg.includes("RATE_LIMITED")) continue;
          const errors = (this.errCounts.get(row.id) ?? 0) + 1;
          this.errCounts.set(row.id, errors);
          if (errors >= MAX_CONSECUTIVE_ERRORS) {
            this.errCounts.delete(row.id);
            await this.repo.updateGeneration(row.id, {
              status: "failed",
              error: msg.slice(0, 500),
            });
            // Que el fallo no le queme el cupo gratis al usuario.
            await this.repo.refundUsage(row.user_id);
          }
          // Menos que el tope: lo reintentamos en el próximo tick.
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async advance(row: GenerationRow): Promise<void> {
    if (!row.meshy_task_id) return; // todavía no se lanzó (no debería pasar)
    const client = this.clientFor(row);
    const task = await client.getTask(row.meshy_task_id, row.kind);

    switch (task.status) {
      case "PENDING":
        await this.repo.updateGeneration(row.id, { status: "processing", progress: 0 });
        break;
      case "IN_PROGRESS": {
        // Para text: preview = 0-50%, refine = 50-100%, así la barra no "retrocede".
        const progress =
          row.kind === "text"
            ? row.stage === "preview"
              ? Math.round(task.progress / 2)
              : 50 + Math.round(task.progress / 2)
            : task.progress;
        await this.repo.updateGeneration(row.id, { status: "processing", progress });
        break;
      }
      case "SUCCEEDED": {
        if (client.twoStage && row.kind === "text" && row.stage === "preview") {
          // Encadenar refine para conseguir texturas.
          const refineId = await client.createTextRefine(row.meshy_task_id);
          await this.repo.updateGeneration(row.id, {
            stage: "refine",
            meshy_task_id: refineId,
            progress: 50,
          });
          return;
        }
        let urls = (task.model_urls ?? {}) as Record<string, string>;
        let thumbnailUrl: string | null = task.thumbnail_url ?? null;
        if (this.persist) {
          const persisted = await this.persist(row.id, urls, thumbnailUrl);
          urls = persisted.urls;
          thumbnailUrl = persisted.thumbnailUrl;
        }
        await this.repo.updateGeneration(row.id, {
          status: "done",
          progress: 100,
          model_urls: JSON.stringify(urls),
          thumbnail_url: thumbnailUrl,
        });
        break;
      }
      case "FAILED":
      case "CANCELED":
        await this.repo.updateGeneration(row.id, {
          status: "failed",
          error: task.task_error?.message ?? "generation failed",
        });
        // Que el fallo no le queme el cupo gratis al usuario.
        await this.repo.refundUsage(row.user_id);
        break;
    }
  }
}
