import path from "node:path";
import { config } from "../config.js";
import { openDriver, type DbDriver } from "./driver.js";

/**
 * Abre la DB de la app: Postgres si hay DATABASE_URL (Neon), SQLite si no.
 * Las migraciones corren al abrir en ambos dialectos.
 */
export function openDb(sqlitePath?: string): Promise<DbDriver> {
  return openDriver({
    sqlitePath: sqlitePath ?? path.join(config.dataDir, "asst3d.db"),
    databaseUrl: sqlitePath ? undefined : config.databaseUrl,
    dataDir: config.dataDir,
  });
}
