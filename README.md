# Formora

Web de generación de modelos 3D con IA (via [Meshy API](https://docs.meshy.ai)) pensada para game-devs:
describís un personaje/objeto/prop por **texto o imagen**, lo ves en un **visor 3D** en el navegador
y lo descargás en **GLB / FBX / OBJ / USDZ** listo para tu motor de juego.

## Producción: evitar el cold start (plan free de Render)

El plan free de Render duerme el servicio tras ~15 min sin tráfico y la primera visita
tarda ~40s en despertar. Solución gratis: crear un monitor en [uptimerobot.com](https://uptimerobot.com)
(free) que haga GET a `https://asst3d.onrender.com/api/health` cada 5 minutos — el servicio
queda siempre despierto y de paso te avisa por mail si la web se cae.

## Correr en desarrollo

```bash
pnpm install
pnpm --filter @asst3d/server gen:samples   # una sola vez: genera los GLB del modo mock
pnpm dev                                    # levanta server (8787) + web (5199)
```

Abrí http://localhost:5199. Sin API key la app corre en **modo MOCK**: simula la generación
sin gastar créditos, usando modelos de muestra locales.

## Conectar la API real de Meshy

1. Copiá `.env.example` a `.env` en la raíz.
2. Cargá tu key: `MESHY_API_KEY=msy_...` y poné `MESHY_MOCK=false`.
3. Reiniciá el server. La key vive **solo en el server** — nunca en el frontend ni en el repo.

## Control de uso (server-authoritative)

Todo se decide en el server; el cliente solo muestra el resultado:

| Control | Env | Default |
| --- | --- | --- |
| Generaciones gratis por usuario (device+IP) | `FREE_GENERATIONS_PER_USER` | 3 |
| Tope global de la app por mes | `GLOBAL_MONTHLY_CAP` | 200 |
| Balance mínimo de Meshy para seguir | `MESHY_MIN_BALANCE` | 20 |
| Rate limit por minuto / por hora | `RATE_LIMIT_MAX_PER_*` | 3 / 10 |

Respuestas de rechazo: `429 rate_limited`, `402 free_limit_reached`, `503 capacity_reached`.

## Web3 (apagado)

La lógica de acceso por token está lista pero **apagada por flag** (`PAYMENTS_ENABLED=false`):
`/api/wallet/link` vincula la wallet; `/api/wallet/verify-access` responde `payments_off`
sin tocar la chain hasta que el dueño configure `TOKEN_GATE_ADDRESS` y prenda el flag.

## Estructura

- `apps/web` — React + Vite + Three.js (visor con orbit/zoom/wireframe, galería Discover, workspace).
- `apps/server` — Fastify + better-sqlite3 (jobs asíncronos con poller, proxy de descargas, límites).
- `packages/shared` — tipos y presets compartidos (low-poly / realista / stylized / pixel-3D).

La capa de datos usa SQL portable para migrar de SQLite a Postgres al momento del deploy.

## Tests

```bash
pnpm --filter @asst3d/server test   # límites + poller (14 tests)
pnpm typecheck
```
