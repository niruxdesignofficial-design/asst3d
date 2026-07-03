import type { Repo, GenerationRow } from "./db/repo.js";
import type { MeshyClient } from "./meshy/types.js";

/**
 * Un solo loop en el server consulta las tasks activas a Meshy y actualiza la DB.
 * Los clientes hacen polling contra NUESTRA DB, nunca contra Meshy.
 *
 * text-to-3D es en dos etapas: preview (geometría) -> refine (texturas).
 * El poller encadena la segunda etapa automáticamente.
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
     * Hook opcional para persistir los modelos al completar (las URLs de los
     * proveedores expiran). Recibe las URLs upstream y devuelve las definitivas.
     */
    private persist?: (
      generationId: string,
      urls: Record<string, string>
    ) => Promise<Record<string, string>>
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.busy) return; // no solapar ticks si Meshy tarda
    this.busy = true;
    try {
      for (const row of this.repo.listActive()) {
        try {
          await this.advance(row);
          this.errCounts.delete(row.id);
        } catch (err) {
          const errors = (this.errCounts.get(row.id) ?? 0) + 1;
          this.errCounts.set(row.id, errors);
          if (errors >= MAX_CONSECUTIVE_ERRORS) {
            this.errCounts.delete(row.id);
            this.repo.updateGeneration(row.id, {
              status: "failed",
              error: String((err as Error)?.message ?? err).slice(0, 500),
            });
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
    const task = await this.meshy.getTask(row.meshy_task_id, row.kind);

    switch (task.status) {
      case "PENDING":
        this.repo.updateGeneration(row.id, { status: "processing", progress: 0 });
        break;
      case "IN_PROGRESS": {
        // Para text: preview = 0-50%, refine = 50-100%, así la barra no "retrocede".
        const progress =
          row.kind === "text"
            ? row.stage === "preview"
              ? Math.round(task.progress / 2)
              : 50 + Math.round(task.progress / 2)
            : task.progress;
        this.repo.updateGeneration(row.id, { status: "processing", progress });
        break;
      }
      case "SUCCEEDED": {
        if (this.meshy.twoStage && row.kind === "text" && row.stage === "preview") {
          // Encadenar refine para conseguir texturas.
          const refineId = await this.meshy.createTextRefine(row.meshy_task_id);
          this.repo.updateGeneration(row.id, {
            stage: "refine",
            meshy_task_id: refineId,
            progress: 50,
          });
          return;
        }
        let urls = (task.model_urls ?? {}) as Record<string, string>;
        if (this.persist) urls = await this.persist(row.id, urls);
        this.repo.updateGeneration(row.id, {
          status: "done",
          progress: 100,
          model_urls: JSON.stringify(urls),
          thumbnail_url: task.thumbnail_url ?? null,
        });
        break;
      }
      case "FAILED":
      case "CANCELED":
        this.repo.updateGeneration(row.id, {
          status: "failed",
          error: task.task_error?.message ?? "generation failed",
        });
        break;
    }
  }
}
